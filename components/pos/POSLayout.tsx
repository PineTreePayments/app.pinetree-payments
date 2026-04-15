"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { CheckCircle, XCircle } from "lucide-react"
import QRCode from "qrcode"
import { supabase } from "@/lib/supabaseClient"
import AmountDisplay from "./AmountDisplay"
import Keypad from "./Keypad"

type Props = {
  locked: boolean
  terminalContext?: {
    merchantId: string
    terminalId?: string
    provider?: string
  } | null
}

type Status =
  | "ready"
  | "confirm"
  | "cash-tender"
  | "cash-change"
  | "waiting"
  | "processing"
  | "confirmed"
  | "incomplete"
  | "failed"

type AvailableMethods = {
  cash: boolean
  crypto: boolean
  card: boolean
}

type Breakdown = {
  subtotalAmount: number
  taxAmount: number
  taxEnabled: boolean
  taxRate: number
  serviceFee: number
  totalAmount: number
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0
  )
}

// Resolve a DB status string to a UI Status
function resolveUiStatus(dbStatus: string): Status | null {
  const s = String(dbStatus || "").toUpperCase()
  if (s === "PROCESSING") return "processing"
  if (s === "CONFIRMED") return "confirmed"
  if (s === "FAILED") return "failed"
  if (s === "INCOMPLETE" || s === "EXPIRED") return "incomplete"
  return null
}

export default function POSLayout({ locked, terminalContext }: Props) {

  const [digits, setDigits] = useState("")
  const [status, setStatus] = useState<Status>("ready")
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [paymentId, setPaymentId] = useState("")   // may be intentId OR direct paymentId
  const [intentId, setIntentId] = useState("")     // set only when intent flow is used
  const [paymentError, setPaymentError] = useState("")
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [availableMethods, setAvailableMethods] = useState<AvailableMethods>({ cash: true, crypto: true, card: false })
  const [cashDigits, setCashDigits] = useState("")

  // Holds the resolved actual payment ID once the customer selects a network on intent
  const resolvedPaymentIdRef = useRef<string>("")

  const subtotal = (Number(digits || "0") / 100).toFixed(2)

  function resetSale() {
    setDigits("")
    setStatus("ready")
    setQrCodeUrl("")
    setPaymentId("")
    setIntentId("")
    setPaymentError("")
    setBreakdown(null)
    setCashDigits("")
    setAvailableMethods({ cash: true, crypto: true, card: false })
    resolvedPaymentIdRef.current = ""
  }

  /* =========================
     REALTIME: DIRECT PAYMENT
     Watches payments table when we have a real paymentId (non-intent flow).
  ========================= */

  useEffect(() => {
    if (!paymentId || intentId) return   // skip — intent handles its own subscription

    const channel = supabase
      .channel(`pos-payment-${paymentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `id=eq.${paymentId}`
        },
        (payload) => {
          const next = resolveUiStatus(payload.new.status)
          if (!next) return
          setStatus(next)
          if (next === "confirmed") setTimeout(resetSale, 3000)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId, intentId])

  /* =========================
     REALTIME: INTENT FLOW
     1. Subscribe to payment_intents table — fires when customer selects a network
        and payment_id is linked on the intent row.
     2. Once payment_id is known, subscribe to payments table for that row.
     Blockchain confirmation is handled server-side by the Vercel cron job
     (/api/cron/check-payments) — no client-side polling needed.
  ========================= */

  useEffect(() => {
    if (!intentId) return

    let paymentChannel: ReturnType<typeof supabase.channel> | null = null

    function subscribeToPayment(pid: string) {
      if (resolvedPaymentIdRef.current === pid) return   // already subscribed
      resolvedPaymentIdRef.current = pid

      paymentChannel = supabase
        .channel(`pos-resolved-payment-${pid}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "payments",
            filter: `id=eq.${pid}`
          },
          (payload) => {
            const next = resolveUiStatus(payload.new.status)
            if (!next) return
            setStatus(next)
            if (next === "confirmed") setTimeout(resetSale, 3000)
          }
        )
        .subscribe()
    }

    // Watch the intent row so we notice when the customer selects a network
    const intentChannel = supabase
      .channel(`pos-intent-${intentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payment_intents",
          filter: `id=eq.${intentId}`
        },
        (payload) => {
          const linkedPaymentId = String(payload.new.payment_id || "").trim()
          if (linkedPaymentId) subscribeToPayment(linkedPaymentId)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(intentChannel)
      if (paymentChannel) supabase.removeChannel(paymentChannel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId])

  /* =========================
     FETCH BREAKDOWN
  ========================= */

  async function fetchBreakdown(amount: number): Promise<Breakdown | null> {
    const merchantId = terminalContext?.merchantId
    if (!merchantId) return null
    try {
      const res = await fetch(
        `/api/pos/breakdown?merchantId=${encodeURIComponent(merchantId)}&amount=${amount}`
      )
      if (!res.ok) return null
      return (await res.json()) as Breakdown
    } catch {
      return null
    }
  }

  /* =========================
     GO TO CONFIRM
  ========================= */

  async function goToConfirm() {
    if (!digits || Number(subtotal) <= 0) return
    setStatus("confirm")
    setBreakdown(null)
    setBreakdownLoading(true)

    const merchantId = terminalContext?.merchantId
    const [breakdownData, methodsData] = await Promise.all([
      fetchBreakdown(Number(subtotal)),
      merchantId
        ? fetch(`/api/pos/methods?merchantId=${encodeURIComponent(merchantId)}`).then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null)
    ])

    setBreakdown(breakdownData)
    if (methodsData) {
      setAvailableMethods({
        cash: methodsData.cash ?? true,
        crypto: methodsData.crypto ?? true,
        card: methodsData.card ?? false
      })
    }
    setBreakdownLoading(false)
  }

  /* =========================
     CASH FLOW
  ========================= */

  function startCash() {
    setCashDigits("")
    setStatus("cash-tender")
  }

  const cashTendered = (Number(cashDigits || "0") / 100)
  const totalDue = breakdown ? breakdown.totalAmount : Number(subtotal)
  const changeDue = cashTendered - totalDue

  function confirmCashTender() {
    if (cashTendered < totalDue) return
    setStatus("cash-change")
  }

  /* =========================
     CRYPTO PAYMENT
  ========================= */

  async function startCrypto() {
    if (!digits || Number(subtotal) <= 0) return

    try {
      setStatus("waiting")

      const res = await fetch("/api/pos/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(subtotal),
          currency: "USD",
          terminal: terminalContext
        })
      })

      const data = await res.json()

      if (!res.ok || !data) {
        setPaymentError("Payment failed to create")
        setStatus("failed")
        return
      }

      // Store IDs — the API always returns intentId when using the intent flow.
      // paymentId here is the intentId; we store intentId separately so
      // the correct realtime path is taken.
      const returnedIntentId = String(data.intentId || "").trim()
      const returnedPaymentId = String(data.paymentId || "").trim()

      if (returnedIntentId) {
        setIntentId(returnedIntentId)
      }
      setPaymentId(returnedPaymentId)

      if (data.paymentUrl) {
        const qr = await QRCode.toDataURL(data.paymentUrl)
        setQrCodeUrl(qr)
      }

    } catch {
      setStatus("failed")
    }
  }

  const displayTotal = breakdown
    ? fmtUsd(breakdown.totalAmount)
    : `$${subtotal}`

  return (
    <div className="flex flex-col items-center w-full px-4">

      <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-[420px]">

        {/* ── READY ── */}
        {status === "ready" && (
          <div className="space-y-4">
            <AmountDisplay amount={subtotal} />
            <Keypad digits={digits} setDigits={setDigits} />
            <button
              onClick={goToConfirm}
              disabled={Number(subtotal) <= 0}
              className="w-full bg-[#0052FF] text-white mt-2 py-3 rounded-xl font-semibold disabled:opacity-40"
            >
              Charge
            </button>
          </div>
        )}

        {/* ── CONFIRM ── */}
        {status === "confirm" && (
          <div className="space-y-5">

            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">
                Confirm Payment
              </p>
              <p className="text-3xl font-bold text-gray-900">{displayTotal}</p>
            </div>

            {breakdownLoading && (
              <p className="text-sm text-center text-gray-500">Calculating breakdown…</p>
            )}

            {!breakdownLoading && breakdown && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{fmtUsd(breakdown.subtotalAmount)}</span>
                </div>
                {breakdown.taxEnabled && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tax ({breakdown.taxRate}%)</span>
                    <span>{fmtUsd(breakdown.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>PineTree Service Fee</span>
                  <span>{fmtUsd(breakdown.serviceFee)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-2">
                  <span>Total</span>
                  <span>{fmtUsd(breakdown.totalAmount)}</span>
                </div>
              </div>
            )}

            {!breakdownLoading && !breakdown && (
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-center text-gray-600">
                Amount: ${subtotal}
              </div>
            )}

            {!breakdownLoading && (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-widest text-gray-500 text-center">
                  Select Payment Method
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={startCash}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl bg-green-50 border border-green-200 text-green-800 font-semibold text-sm hover:bg-green-100 transition"
                  >
                    <span className="text-xl">💵</span>
                    Cash
                  </button>
                  <button
                    onClick={startCrypto}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-semibold text-sm hover:bg-blue-100 transition"
                  >
                    <span className="text-xl">₿</span>
                    Crypto
                  </button>
                  <button
                    disabled={!availableMethods.card}
                    title={!availableMethods.card ? "Card payments not connected" : undefined}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl bg-gray-50 border border-gray-200 text-gray-400 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <span className="text-xl">💳</span>
                    Card
                  </button>
                </div>
                <button
                  onClick={resetSale}
                  className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
                >
                  Cancel
                </button>
              </div>
            )}

          </div>
        )}

        {/* ── CASH TENDER ── */}
        {status === "cash-tender" && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Cash Payment</p>
              <p className="text-3xl font-bold text-gray-900">{fmtUsd(totalDue)}</p>
              <p className="text-sm text-gray-500 mt-1">Amount Due</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Cash Tendered</p>
              <p className="text-2xl font-semibold text-gray-900">
                {cashDigits ? fmtUsd(cashTendered) : <span className="text-gray-300">$0.00</span>}
              </p>
            </div>

            <Keypad digits={cashDigits} setDigits={setCashDigits} />

            {cashDigits && cashTendered < totalDue && (
              <p className="text-center text-sm text-red-500">
                Amount is less than total due
              </p>
            )}

            <button
              onClick={confirmCashTender}
              disabled={!cashDigits || cashTendered < totalDue}
              className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold disabled:opacity-40"
            >
              Confirm Cash
            </button>
            <button
              onClick={() => setStatus("confirm")}
              className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
            >
              Back
            </button>
          </div>
        )}

        {/* ── CASH CHANGE ── */}
        {status === "cash-change" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <span className="text-3xl">💵</span>
            </div>
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Change Due</p>
              {changeDue > 0.005 ? (
                <p className="text-4xl font-bold text-green-600">{fmtUsd(changeDue)}</p>
              ) : (
                <p className="text-xl font-semibold text-gray-700">No change due</p>
              )}
            </div>
            <div className="w-full bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Total Charged</span>
                <span>{fmtUsd(totalDue)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Cash Tendered</span>
                <span>{fmtUsd(cashTendered)}</span>
              </div>
              {changeDue > 0.005 && (
                <div className="flex justify-between font-semibold text-green-700 border-t border-gray-200 pt-1.5">
                  <span>Change</span>
                  <span>{fmtUsd(changeDue)}</span>
                </div>
              )}
            </div>
            <button
              onClick={async () => {
                if (terminalContext?.terminalId && terminalContext?.merchantId) {
                  fetch("/api/pos/drawer/sale", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      terminalId: terminalContext.terminalId,
                      merchantId: terminalContext.merchantId,
                      saleTotal: totalDue,
                      cashTendered,
                      changeGiven: Math.max(0, changeDue)
                    })
                  }).catch(() => {/* non-fatal */})
                }
                resetSale()
              }}
              className="w-full bg-[#0052FF] text-white py-3 rounded-xl font-semibold"
            >
              Complete Sale
            </button>
          </div>
        )}

        {/* ── WAITING / PROCESSING ── */}
        {(status === "waiting" || status === "processing") && (
          <div className="space-y-5">

            {qrCodeUrl ? (
              <div className="flex flex-col items-center">
                <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">
                  Scan to Pay
                </p>
                <Image
                  src={qrCodeUrl}
                  width={200}
                  height={200}
                  alt="QR code"
                  className="rounded-xl"
                />
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#0052FF] border-t-transparent mx-auto" />
                <p className="text-sm text-gray-500 mt-3">Preparing payment…</p>
              </div>
            )}

            {breakdown && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{fmtUsd(breakdown.subtotalAmount)}</span>
                </div>
                {breakdown.taxEnabled && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tax ({breakdown.taxRate}%)</span>
                    <span>{fmtUsd(breakdown.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>PineTree Service Fee</span>
                  <span>{fmtUsd(breakdown.serviceFee)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-2">
                  <span>Total</span>
                  <span>{fmtUsd(breakdown.totalAmount)}</span>
                </div>
              </div>
            )}

            <p className="text-sm text-center text-gray-500">
              {status === "waiting" ? "Waiting for payment…" : "Processing…"}
            </p>

            <button
              onClick={resetSale}
              className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
            >
              Cancel sale
            </button>

          </div>
        )}

        {/* ── CONFIRMED ── */}
        {status === "confirmed" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle size={60} className="text-green-500" />
            <p className="text-lg font-semibold text-gray-900">Payment Confirmed</p>
          </div>
        )}

        {/* ── INCOMPLETE ── */}
        {status === "incomplete" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <XCircle size={60} className="text-amber-500" />
            <p className="text-lg font-semibold text-gray-900">Payment Incomplete</p>
            <p className="text-sm text-gray-500 text-center">
              The payment was not fully received.
            </p>
            <button onClick={resetSale} className="mt-2 px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">
              Back
            </button>
          </div>
        )}

        {/* ── FAILED ── */}
        {status === "failed" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <XCircle size={60} className="text-red-500" />
            <p className="text-lg font-semibold text-gray-900">Payment Failed</p>
            {paymentError && (
              <p className="text-sm text-gray-500 text-center">{paymentError}</p>
            )}
            <button onClick={resetSale} className="mt-2 px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">
              Try Again
            </button>
          </div>
        )}

      </div>

    </div>
  )
}
