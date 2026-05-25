"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabaseClient"
import AmountDisplay from "./AmountDisplay"
import Keypad from "./Keypad"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
import BaseWalletPayment from "@/components/payment/BaseWalletPayment"

type Props = {
  locked: boolean
  terminalContext?: {
    merchantId: string
    terminalId?: string
    provider?: string
    sessionToken?: string
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
  | "expired"
  | "base_wc"

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
  if (s === "INCOMPLETE") return "incomplete"
  if (s === "EXPIRED") return "expired"
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

function posAuthHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function POSLayout({ terminalContext }: Props) {

  const [digits, setDigits] = useState("")
  const [status, setStatus] = useState<Status>("ready")
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [intentId, setIntentId] = useState("")
  const [activePaymentId, setActivePaymentId] = useState("")
  const [paymentError, setPaymentError] = useState("")
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [availableMethods, setAvailableMethods] = useState<AvailableMethods>({ cash: true, crypto: false, card: false })
  const [cashDigits, setCashDigits] = useState("")
  const [cashRecording, setCashRecording] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [basePaymentAsset, setBasePaymentAsset] = useState<"ETH" | "USDC" | null>(null)
  const [basePaymentId, setBasePaymentId] = useState("")
  const [basePaymentUrl, setBasePaymentUrl] = useState("")
  const [basePaymentUsdAmount, setBasePaymentUsdAmount] = useState(0)
  const [baseStatusQrCodeUrl, setBaseStatusQrCodeUrl] = useState("")
  const [baseStatusUrl, setBaseStatusUrl] = useState("")

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
    setCashRecording(false)
    setAvailableMethods({ cash: true, crypto: false, card: false })
    setBasePaymentAsset(null)
    setBasePaymentId("")
    setBasePaymentUrl("")
    setBasePaymentUsdAmount(0)
    setBaseStatusQrCodeUrl("")
    setBaseStatusUrl("")
    resolvedPaymentIdRef.current = ""
  }

  async function cancelSale() {
    if (intentId) {
      setCanceling(true)
      try {
        await fetch(`/api/payment-intents/${encodeURIComponent(intentId)}/cancel`, {
          method: "POST",
          headers: posAuthHeaders(terminalContext?.sessionToken),
        })
      } catch {
        // best-effort — always reset local state even if the API call fails
      } finally {
        setCanceling(false)
      }
    }
    resetSale()
  }

  function applyPaymentStatus(dbStatus: string) {
    const next = resolveUiStatus(dbStatus)
    if (!next) return

    setStatus(next)

    if (next === "confirmed" || next === "failed" || next === "incomplete" || next === "expired") {
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
     Polls every 3s while waiting or processing.
     Uses paymentId when available; falls back to intentId so POS updates
     even if the Supabase realtime intent→payment link event was missed.
  ========================= */

  useEffect(() => {
    const pid = activePaymentId
    const iid = intentId
    // Build the query param: prefer paymentId, fall back to intentId
    const pollParam = pid
      ? `paymentId=${encodeURIComponent(pid)}`
      : iid
        ? `intentId=${encodeURIComponent(iid)}`
        : ""

    if (!pollParam || (status !== "waiting" && status !== "processing" && status !== "base_wc")) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/status?${pollParam}`)
        if (!res.ok) return
        const data = await res.json()
        // If polling by intent and we just learned the paymentId, store it so
        // the direct-payment realtime subscription can start (and future polls
        // use the faster paymentId path).
        if (!pid && data.paymentId) {
          setActivePaymentId(String(data.paymentId))
        }
        applyPaymentStatus(String(data?.status || ""))
      } catch {
        // non-fatal — realtime is the primary update path
      }
    }, 3000)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePaymentId, intentId, status])

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
    const token = terminalContext?.sessionToken
    if (!token) return null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(
        `/api/pos/breakdown?amount=${amount}`,
        { headers: posAuthHeaders(token), signal: controller.signal }
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

    const token = terminalContext?.sessionToken
    const [breakdownData, methodsData] = await Promise.all([
      fetchBreakdown(subtotalNum),
      token
        ? fetch("/api/pos/methods", { headers: posAuthHeaders(token) })
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        : Promise.resolve(null)
    ])

    setBreakdown(breakdownData)
    if (methodsData) {
      setAvailableMethods({
        cash: methodsData.cash ?? true,
        crypto: methodsData.cryptoAvailable === true,
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
    setPaymentError("")
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
        headers: {
          "Content-Type": "application/json",
          ...posAuthHeaders(terminalContext?.sessionToken),
        },
        body: JSON.stringify({
          amount: subtotalNum,
          currency: "USD",
        }),
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

  async function startBasePayment(asset: "ETH" | "USDC") {
    if (!digits || subtotalNum <= 0) return
    setPaymentError("")
    setBasePaymentAsset(asset)
    setStatus("waiting")
    try {
      const res = await fetch("/api/pos/payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...posAuthHeaders(terminalContext?.sessionToken),
        },
        body: JSON.stringify({ amount: subtotalNum, currency: "USD", network: "base", asset }),
      })
      const data = await res.json()
      if (!res.ok || !data?.paymentId) {
        setPaymentError(data?.error || "Payment failed to create")
        setStatus("failed")
        return
      }
      const pid = String(data.paymentId || "").trim()
      const pUrl = String(data.paymentUrl || "").trim()
      const usdAmt = Number(data.breakdown?.totalAmount || subtotalNum)
      setBasePaymentId(pid)
      setBasePaymentUrl(pUrl)
      setBasePaymentUsdAmount(usdAmt)
      if (data.statusQrCodeUrl) setBaseStatusQrCodeUrl(String(data.statusQrCodeUrl))
      if (data.statusUrl) setBaseStatusUrl(String(data.statusUrl))
      hasScheduledResetRef.current = false
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
      setActivePaymentId(pid)
      setStatus("base_wc")
    } catch {
      setPaymentError("Failed to create Base payment")
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
            <div className="max-w-[340px] mx-auto mt-2">
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
                  <Button
                    variant="secondary"
                    fullWidth
                    onClick={startCash}
                  >
                    Cash
                  </Button>
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={!availableMethods.crypto}
                    onClick={startCrypto}
                  >
                    Crypto
                  </Button>
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={!availableMethods.card}
                  >
                    Card
                  </Button>
                </div>
                {availableMethods.crypto && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={() => void startBasePayment("ETH")}
                    >
                      Base ETH
                    </Button>
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={() => void startBasePayment("USDC")}
                    >
                      Base USDC
                    </Button>
                  </div>
                )}
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

            <div className="max-w-[340px] mx-auto space-y-2">
              <Button fullWidth disabled={!cashDigits || cashTendered < totalDue} onClick={confirmCashTender}>
                Confirm
              </Button>
              <Button variant="secondary" fullWidth onClick={() => setStatus("confirm")}>
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

            {paymentError && (
              <p className="text-center text-sm text-red-500">{paymentError}</p>
            )}

            <Button
              fullWidth
              disabled={cashRecording}
              onClick={async () => {
                if (!terminalContext?.sessionToken) {
                  setPaymentError("Missing terminal session for cash sale")
                  return
                }
                setCashRecording(true)
                try {
                  const res = await fetch("/api/pos/drawer/sale", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      ...posAuthHeaders(terminalContext.sessionToken),
                    },
                    body: JSON.stringify({
                      saleTotal: totalDue,
                      cashTendered,
                      changeGiven: Math.max(0, changeDue),
                      subtotalAmount: breakdown?.subtotalAmount ?? totalDue,
                      serviceFee: breakdown?.serviceFee ?? 0,
                    }),
                  })
                  const payload = await res.json().catch(() => null)
                  if (!res.ok) {
                    throw new Error(payload?.error || "Cash sale failed")
                  }
                  resetSale()
                } catch (err) {
                  setPaymentError(err instanceof Error ? err.message : "Cash sale failed")
                  setCashRecording(false)
                }
              }}
            >
              {cashRecording ? "Recording..." : "New Sale"}
            </Button>

          </div>
        )}

        {/* ── WAITING / PROCESSING ── */}
        {(status === "waiting" || status === "processing") && (
          <div className="space-y-3">

            {qrCodeUrl ? (
              <div className="flex flex-col items-center rounded-2xl border border-blue-100/70 bg-gradient-to-br from-white to-blue-50/40 px-4 py-4 shadow-[0_12px_32px_rgba(0,82,255,0.08)]">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Scan to Pay
                </p>
                <Image
                  src={qrCodeUrl}
                  width={172}
                  height={172}
                  alt="QR code"
                  className="rounded-xl shadow-sm"
                />
                <PaymentStatusVisual
                  status={status === "waiting" ? "PENDING" : "PROCESSING"}
                  size="compact"
                  iconSize={18}
                  showMessage={false}
                  labelClassName="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]"
                  className="mt-3 gap-1.5"
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-blue-100/70 bg-blue-50/50 px-4 py-4 text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">Preparing payment…</p>
              </div>
            )}

            {breakdown && (
              <div className="space-y-1.5 rounded-2xl border border-gray-100 bg-gray-50/80 px-3.5 py-3 text-sm shadow-inner shadow-white">
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
                <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-1.5">
                  <span>Total</span>
                  <span>{fmtUsd(breakdown.totalAmount)}</span>
                </div>
              </div>
            )}

            <Button variant="danger" fullWidth disabled={canceling} onClick={() => void cancelSale()}>
              {canceling ? "Canceling…" : "Cancel Sale"}
            </Button>

          </div>
        )}

        {/* ── CONFIRMED ── */}
        {status === "confirmed" && (
          <div className="py-3">
            <PaymentStatusVisual status="CONFIRMED" variant="card" />
          </div>
        )}

        {/* ── INCOMPLETE ── */}
        {status === "incomplete" && (
          <div className="flex flex-col items-center gap-3 py-3">
            <PaymentStatusVisual status="INCOMPLETE" variant="card" />
            <Button variant="secondary" fullWidth onClick={resetSale}>
              Back
            </Button>
          </div>
        )}

        {/* ── FAILED ── */}
        {status === "failed" && (
          <div className="flex flex-col items-center gap-3 py-3">
            <PaymentStatusVisual
              status="FAILED"
              variant="card"
              messageOverride={paymentError || undefined}
            />
            {paymentError && (
              <span className="sr-only">{paymentError}</span>
            )}
            <Button fullWidth onClick={resetSale}>
              Try Again
            </Button>
          </div>
        )}

        {/* ── EXPIRED ── */}
        {status === "expired" && (
          <div className="flex flex-col items-center gap-3 py-3">
            <PaymentStatusVisual status="EXPIRED" variant="card" />
            <Button variant="secondary" fullWidth onClick={resetSale}>
              Back
            </Button>
          </div>
        )}

        {/* ── BASE WALLETCONNECT (POS terminal owns session) ── */}
        {status === "base_wc" && basePaymentId && basePaymentUrl && basePaymentAsset && (
          <div className="space-y-3">
            {baseStatusQrCodeUrl && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#0052FF] mb-1">
                  Customer Status Screen
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  Customer scans to follow payment progress
                </p>
                <Image
                  src={baseStatusQrCodeUrl}
                  width={96}
                  height={96}
                  alt="Customer payment status QR"
                  className="mx-auto rounded-lg"
                />
                {baseStatusUrl && (
                  <p className="mt-1.5 text-[10px] text-gray-400 break-all leading-tight">
                    {baseStatusUrl}
                  </p>
                )}
              </div>
            )}
            <BaseWalletPayment
              paymentId={basePaymentId}
              paymentUrl={basePaymentUrl}
              selectedAsset={basePaymentAsset}
              usdAmount={basePaymentUsdAmount}
              onSuccess={async (txHash, pid) => {
                try {
                  await fetch(`/api/payments/${encodeURIComponent(pid)}/detect`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ txHash }),
                  })
                } catch {
                  // non-fatal — watcher will confirm
                }
                setStatus("confirmed")
              }}
              onError={(err) => {
                setPaymentError(err || "Payment failed")
                setStatus("failed")
              }}
              onCancel={resetSale}
            />
          </div>
        )}

      </div>

    </div>
  )
}
