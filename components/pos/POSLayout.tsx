"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { CheckCircle, XCircle } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import AmountDisplay from "./AmountDisplay"
import Keypad from "./Keypad"
import Button from "@/components/ui/Button"

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
  if (s === "CREATED" || s === "PENDING") return "waiting"
  if (s === "PROCESSING") return "processing"
  if (s === "CONFIRMED") return "confirmed"
  if (s === "FAILED") return "failed"
  if (s === "INCOMPLETE" || s === "EXPIRED") return "incomplete"
  return null
}

// Parse digits → number (no decimal = whole dollars, e.g. "12" → 12.00)
function digitsToNumber(d: string): number {
  if (!d) return 0
  if (d.includes(".")) return parseFloat(d) || 0
  return Number(d) || 0
}

// Human-readable amount display during entry
function digitsToDisplay(d: string): string {
  if (!d) return "0.00"
  if (d.includes(".")) return d              // show raw during decimal entry
  return `${d}.00`                           // "12" → "12.00"
}

export default function POSLayout({ locked, terminalContext }: Props) {

  const [digits, setDigits] = useState("")
  const [status, setStatus] = useState<Status>("ready")
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [intentId, setIntentId] = useState("")
  const [activePaymentId, setActivePaymentId] = useState("")
  const [paymentError, setPaymentError] = useState("")
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [availableMethods, setAvailableMethods] = useState<AvailableMethods>({ cash: true, crypto: true, card: false })
  const [cashDigits, setCashDigits] = useState("")

  const resolvedPaymentIdRef = useRef<string>("")
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hasScheduledResetRef = useRef(false)

  const subtotalNum = digitsToNumber(digits)
  const displayAmount = digitsToDisplay(digits)

  function resetSale() {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
    hasScheduledResetRef.current = false
    setDigits("")
    setStatus("ready")
    setQrCodeUrl("")
    setIntentId("")
    setActivePaymentId("")
    setPaymentError("")
    setBreakdown(null)
    setCashDigits("")
    setAvailableMethods({ cash: true, crypto: true, card: false })
    resolvedPaymentIdRef.current = ""
  }

  function applyPaymentStatus(dbStatus: string) {
    const next = resolveUiStatus(dbStatus)
    if (!next) return

    setStatus(next)

    if (next === "confirmed" || next === "failed" || next === "incomplete") {
      if (!hasScheduledResetRef.current) {
        hasScheduledResetRef.current = true

        console.log("[POS] Scheduling reset...")

        resetTimerRef.current = setTimeout(() => {
          resetSale()
          hasScheduledResetRef.current = false
          resetTimerRef.current = null
        }, 3000)
      }
    }
  }

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  /* =========================
     POLLING FALLBACK
     Triggers the blockchain watcher every 5s while waiting.
     Realtime handles the UI update once the DB changes.
  ========================= */

  useEffect(() => {
    if (!activePaymentId || (status !== "waiting" && status !== "processing")) return

    const id = activePaymentId
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/status?paymentId=${encodeURIComponent(id)}`)
        if (!res.ok) return
        const data = await res.json()
        applyPaymentStatus(String(data?.status || ""))
      } catch {
        // non-fatal — realtime is the primary update path
      }
    }, 5000)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePaymentId, status])

  /* =========================
     REALTIME: DIRECT PAYMENT
  ========================= */

  useEffect(() => {
    if (!activePaymentId || intentId) return

    const channel = supabase
      .channel(`pos-payment-${activePaymentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `id=eq.${activePaymentId}`
        },
        (payload) => {
          applyPaymentStatus(String(payload.new.status || ""))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePaymentId, intentId])

  /* =========================
     REALTIME: INTENT FLOW
  ========================= */

  useEffect(() => {
    if (!intentId) return

    let paymentChannel: ReturnType<typeof supabase.channel> | null = null

    function subscribeToPayment(pid: string) {
      if (resolvedPaymentIdRef.current === pid) return
      hasScheduledResetRef.current = false
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
      resolvedPaymentIdRef.current = pid
      setActivePaymentId(pid)

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
            applyPaymentStatus(String(payload.new.status || ""))
          }
        )
        .subscribe()
    }

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
     FETCH BREAKDOWN (5s timeout)
  ========================= */

  async function fetchBreakdown(amount: number): Promise<Breakdown | null> {
    const merchantId = terminalContext?.merchantId
    if (!merchantId) return null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(
        `/api/pos/breakdown?merchantId=${encodeURIComponent(merchantId)}&amount=${amount}`,
        { signal: controller.signal }
      )
      clearTimeout(timer)
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
    if (!digits || subtotalNum <= 0) return
    setStatus("confirm")
    setBreakdown(null)
    setBreakdownLoading(true)

    const merchantId = terminalContext?.merchantId
    const [breakdownData, methodsData] = await Promise.all([
      fetchBreakdown(subtotalNum),
      merchantId
        ? fetch(`/api/pos/methods?merchantId=${encodeURIComponent(merchantId)}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
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

  const cashTendered = digitsToNumber(cashDigits)
  const totalDue = breakdown ? breakdown.totalAmount : subtotalNum
  const changeDue = cashTendered - totalDue

  function confirmCashTender() {
    if (cashTendered < totalDue) return
    setStatus("cash-change")
  }

  /* =========================
     CRYPTO PAYMENT
  ========================= */

  async function startCrypto() {
    if (!digits || subtotalNum <= 0) return

    try {
      setStatus("waiting")

      const res = await fetch("/api/pos/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: subtotalNum,
          currency: "USD",
          terminal: terminalContext
        })
      })

      const data = await res.json()

      if (!res.ok || !data) {
        setPaymentError(data?.error || "Payment failed to create")
        setStatus("failed")
        return
      }

      const returnedIntentId = String(data.intentId || "").trim()
      const returnedPaymentId = String(data.paymentId || "").trim()

      if (returnedIntentId) setIntentId(returnedIntentId)
      if (returnedPaymentId && !returnedIntentId) {
        hasScheduledResetRef.current = false
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current)
          resetTimerRef.current = null
        }
        setActivePaymentId(returnedPaymentId)
      }

      if (data.qrCodeUrl) {
        setQrCodeUrl(data.qrCodeUrl)
      }

    } catch {
      setStatus("failed")
    }
  }

  const displayTotal = breakdown
    ? fmtUsd(breakdown.totalAmount)
    : fmtUsd(subtotalNum)

  return (
    <div className="flex flex-col items-center w-full px-4">

      <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-[420px]">

        {/* ── READY ── */}
        {status === "ready" && (
          <div className="space-y-4">
            <AmountDisplay amount={displayAmount} />
            <Keypad digits={digits} setDigits={setDigits} showDecimal />
            <div className="max-w-[300px] mx-auto mt-2">
              <Button fullWidth disabled={subtotalNum <= 0} onClick={goToConfirm}>
                Charge
              </Button>
            </div>
          </div>
        )}

        {/* ── CONFIRM ── */}
        {status === "confirm" && (
          <div className="space-y-5">

            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">
                Total Due
              </p>
              <p className="text-4xl font-bold text-gray-900">{displayTotal}</p>
            </div>

            {breakdownLoading && (
              <div className="flex items-center justify-center gap-2 py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#0052FF] border-t-transparent" />
                <p className="text-sm text-gray-500">Loading breakdown…</p>
              </div>
            )}

            {!breakdownLoading && breakdown && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal</span>
                  <span>{fmtUsd(breakdown.subtotalAmount)}</span>
                </div>
                {breakdown.taxEnabled && (
                  <div className="flex justify-between text-gray-700">
                    <span>Tax ({breakdown.taxRate}%)</span>
                    <span>{fmtUsd(breakdown.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-700">
                  <span>Service Fee</span>
                  <span>{fmtUsd(breakdown.serviceFee)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-2">
                  <span>Total</span>
                  <span>{fmtUsd(breakdown.totalAmount)}</span>
                </div>
              </div>
            )}

            {!breakdownLoading && !breakdown && (
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-center text-gray-700">
                {fmtUsd(subtotalNum)}
              </div>
            )}

            {!breakdownLoading && (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-widest text-gray-500 text-center">
                  Payment Method
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={startCash}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 font-semibold text-sm hover:bg-gray-100 hover:border-gray-300 transition"
                  >
                    <span className="text-xl">💵</span>
                    Cash
                  </button>
                  <button
                    onClick={startCrypto}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 font-semibold text-sm hover:bg-gray-100 hover:border-gray-300 transition"
                  >
                    <span className="text-xl">₿</span>
                    Crypto
                  </button>
                  <button
                    disabled={!availableMethods.card}
                    title={!availableMethods.card ? "Card payments not connected" : undefined}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <span className="text-xl">💳</span>
                    Card
                  </button>
                </div>
                <Button variant="danger" fullWidth onClick={resetSale}>
                  Cancel Payment
                </Button>
              </div>
            )}

          </div>
        )}

        {/* ── CASH TENDER ── */}
        {status === "cash-tender" && (
          <div className="space-y-5">

            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Cash Payment</p>
              <p className="text-4xl font-bold text-gray-900">{fmtUsd(totalDue)}</p>
              <p className="text-sm text-gray-500 mt-1">Amount Due</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Cash Tendered</p>
              <p className="text-3xl font-bold text-gray-900">
                {cashDigits
                  ? fmtUsd(cashTendered)
                  : <span className="text-gray-300">$0.00</span>
                }
              </p>
            </div>

            <Keypad digits={cashDigits} setDigits={setCashDigits} showDecimal />

            {cashDigits && cashTendered < totalDue && (
              <p className="text-center text-sm text-red-500">
                Amount is less than total due
              </p>
            )}

            <div className="max-w-[300px] mx-auto space-y-2">
              <Button fullWidth disabled={!cashDigits || cashTendered < totalDue} onClick={confirmCashTender}>
                Confirm
              </Button>
              <Button variant="danger" fullWidth onClick={() => setStatus("confirm")}>
                Back
              </Button>
            </div>

          </div>
        )}

        {/* ── CASH CHANGE ── */}
        {status === "cash-change" && (
          <div className="space-y-5">

            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Sale Complete</p>
              {changeDue > 0.005 ? (
                <>
                  <p className="text-sm text-gray-500 mb-1">Change Due</p>
                  <p className="text-4xl font-bold text-gray-900">{fmtUsd(changeDue)}</p>
                </>
              ) : (
                <p className="text-2xl font-bold text-gray-900 mt-2">No Change Due</p>
              )}
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-700">
                <span>Total Charged</span>
                <span>{fmtUsd(totalDue)}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>Cash Tendered</span>
                <span>{fmtUsd(cashTendered)}</span>
              </div>
              {changeDue > 0.005 && (
                <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-2">
                  <span>Change</span>
                  <span>{fmtUsd(changeDue)}</span>
                </div>
              )}
            </div>

            <Button
              fullWidth
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
                      changeGiven: Math.max(0, changeDue),
                      subtotalAmount: breakdown?.subtotalAmount ?? totalDue,
                      serviceFee: breakdown?.serviceFee ?? 0
                    })
                  }).catch(() => {/* non-fatal */})
                }
                resetSale()
              }}
            >
              New Sale
            </Button>

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
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal</span>
                  <span>{fmtUsd(breakdown.subtotalAmount)}</span>
                </div>
                {breakdown.taxEnabled && (
                  <div className="flex justify-between text-gray-700">
                    <span>Tax ({breakdown.taxRate}%)</span>
                    <span>{fmtUsd(breakdown.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-700">
                  <span>Service Fee</span>
                  <span>{fmtUsd(breakdown.serviceFee)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-2">
                  <span>Total</span>
                  <span>{fmtUsd(breakdown.totalAmount)}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${
                status === "processing" ? "bg-green-500" : "bg-[#0052FF]"
              }`} />
              <p className="text-sm text-gray-800 font-medium">
                {status === "waiting" ? "Waiting for payment…" : "Processing…"}
              </p>
            </div>

            <Button variant="danger" fullWidth onClick={resetSale}>
              Cancel Sale
            </Button>

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
            <Button variant="secondary" fullWidth onClick={resetSale}>
              Back
            </Button>
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
            <Button fullWidth onClick={resetSale}>
              Try Again
            </Button>
          </div>
        )}

      </div>

    </div>
  )
}
