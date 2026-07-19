"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabaseClient"
import AmountDisplay from "./AmountDisplay"
import Keypad from "./Keypad"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
import PosCardPaymentExperience, {
  type PosCardCapabilities,
  type PosCardView,
} from "./PosCardPaymentExperience"
import {
  initPosBaseWalletConnect,
  waitForWalletConnect,
  type PosWcProvider,
} from "@/lib/pos/posBaseWalletConnect"

type Props = {
  locked: boolean
  onLockControlVisibilityChange?: (visible: boolean) => void
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

type AvailableMethods = {
  cash: boolean
  crypto: boolean
  card: boolean
}

type PaymentMode = "crypto" | "card" | null
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

// ── Base V7 POS helpers (defined outside component — no state dependency) ────

function parseEthereumUri(uri: string): { to: string; valueHex: string; data: string } | null {
  try {
    const withoutScheme = uri.replace(/^ethereum:/, "")
    const qIdx = withoutScheme.indexOf("?")
    const addrPart = qIdx >= 0 ? withoutScheme.slice(0, qIdx) : withoutScheme
    const to = addrPart.includes("@") ? addrPart.split("@")[0] : addrPart
    if (!to.startsWith("0x")) return null
    const params = new URLSearchParams(qIdx >= 0 ? withoutScheme.slice(qIdx + 1) : "")
    const value = params.get("value") || "0"
    const data = params.get("data") || "0x"
    const valueHex = "0x" + BigInt(value).toString(16)
    return { to, valueHex, data }
  } catch {
    return null
  }
}

// Poll allowance-check after USDC approval tx until sufficient or timeout.
// Base block time is ~2 s; 10 × 3 s = 30 s max wait before giving up.
async function waitForAllowanceSufficient(
  paymentId: string,
  walletAddress: string
): Promise<void> {
  const MAX_ATTEMPTS = 10
  const DELAY_MS = 3000
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        `/api/payments/${encodeURIComponent(paymentId)}/base-v7/allowance-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payerAddress: walletAddress }),
        }
      )
      const data = (await res.json()) as { ok: boolean; sufficient?: boolean }
      if (data.ok && data.sufficient) return
    } catch {
      // transient — retry
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, DELAY_MS))
    }
  }
  throw new Error("USDC allowance did not update after approval. Please try again.")
}

async function executePosBaseEip3009(
  paymentId: string,
  walletAddress: string,
  provider: PosWcProvider
): Promise<string> {
  console.log("[POS Base USDC V7] relay_start", { paymentId })
  const prepareRes = await fetch(
    `/api/payments/${encodeURIComponent(paymentId)}/base-v7/prepare`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payerAddress: walletAddress }),
    }
  )
  const prepared = (await prepareRes.json()) as {
    ok: boolean
    typedData?: unknown
    authorization?: { validAfter: string; validBefore: string; nonce: string }
    error?: string
    message?: string
  }
  if (!prepared.ok || !prepared.typedData || !prepared.authorization) {
    const errMsg = prepared.error || prepared.message || "Failed to prepare EIP-3009 authorization"
    console.error("[POS Base USDC V7] relay_start", { paymentId, ok: false, error: errMsg })
    throw new Error(errMsg)
  }

  const signature = await provider.request<string>({
    method: "eth_signTypedData_v4",
    params: [walletAddress, JSON.stringify(prepared.typedData)],
  })
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    console.error("[POS Base USDC V7] relay_start", { paymentId, ok: false, reason: "invalid_signature_format" })
    throw new Error("Wallet did not return a valid EIP-3009 signature")
  }

  const relayRes = await fetch(
    `/api/payments/${encodeURIComponent(paymentId)}/base-v7/relay`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payerAddress: walletAddress,
        authorization: prepared.authorization,
        signature,
      }),
    }
  )
  const relayResult = (await relayRes.json()) as { ok: boolean; txHash?: string; error?: string; message?: string }
  if (!relayResult.ok || !relayResult.txHash) {
    const errMsg = relayResult.error || relayResult.message || "EIP-3009 relay failed"
    console.error("[POS Base USDC V7] relay_resolved", { paymentId, ok: false, error: errMsg })
    throw new Error(errMsg)
  }
  const relayTxHash = relayResult.txHash
  if (!/^0x[a-fA-F0-9]{64}$/.test(relayTxHash)) {
    console.error("[POS Base USDC V7] relay_resolved", { paymentId, ok: false, reason: "invalid_txhash_format" })
    throw new Error("Relay returned an invalid transaction hash")
  }
  console.log("[POS Base USDC V7] relay_resolved", { paymentId, ok: true })
  console.log("[POS Base USDC V7] relay_resolved", {
    paymentId,
    txHashPrefix: relayTxHash.slice(0, 10),
    txHashSuffix: relayTxHash.slice(-6),
  })
  return relayTxHash
}

async function executePosBaseAllowancePath(
  paymentId: string,
  walletAddress: string,
  provider: PosWcProvider
): Promise<string> {
  console.log("[POS Base USDC V7] allowance_build_start", { paymentId })
  const buildRes = await fetch(
    `/api/payments/${encodeURIComponent(paymentId)}/base-v7/build-allowance-payment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payerAddress: walletAddress }),
    }
  )
  const built = (await buildRes.json()) as {
    ok: boolean
    sufficient?: boolean
    approveTx?: { to: string; data: string; value: string } | null
    paymentTx?: { to: string; data: string; value: string }
    error?: string
    message?: string
  }
  if (!built.ok || !built.paymentTx) {
    throw new Error(built.error || built.message || "Failed to build allowance payment")
  }
  console.log("[POS Base USDC V7] allowance_build_resolved", { paymentId })

  if (!built.sufficient && built.approveTx) {
    console.log("[POS Base USDC V7] allowance_approve_start", { paymentId })
    // from is required by WalletConnect v2 to route to the correct account
    await provider.request<string>({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
        to: built.approveTx.to,
        data: built.approveTx.data,
        value: "0x" + BigInt(built.approveTx.value || "0").toString(16),
        chainId: "0x2105",
      }],
    })
    console.log("[POS Base USDC V7] allowance_approve_submitted", { paymentId })
    // Wait for V7 approval to be mined before sending payment tx (~2 s block time on Base)
    await waitForAllowanceSufficient(paymentId, walletAddress)
    console.log("[POS Base USDC V7] allowance_sufficient", { paymentId })
    // Settlement delay: give the mobile WC request queue time to clear before next prompt
    await new Promise<void>((resolve) => setTimeout(resolve, 1000))
  }

  console.log("[POS Base USDC V7] payment_tx_request_start", { paymentId })
  const paymentTxHash = await provider.request<string>({
    method: "eth_sendTransaction",
    params: [{
      from: walletAddress,
      to: built.paymentTx.to,
      data: built.paymentTx.data,
      value: "0x" + BigInt(built.paymentTx.value || "0").toString(16),
      chainId: "0x2105",
    }],
  })
  if (typeof paymentTxHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(paymentTxHash)) {
    throw new Error("Wallet did not return a valid transaction hash for USDC payment")
  }
  console.log("[POS Base USDC V7] payment_tx_hash_captured", {
    paymentId,
    txHashPrefix: paymentTxHash.slice(0, 10),
    txHashSuffix: paymentTxHash.slice(-6),
  })
  return paymentTxHash
}

export default function POSLayout({ terminalContext, onLockControlVisibilityChange }: Props) {

  const [digits, setDigits] = useState("")
  const [status, setStatus] = useState<Status>("ready")
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [intentId, setIntentId] = useState("")
  const [activePaymentId, setActivePaymentId] = useState("")
  const [paymentError, setPaymentError] = useState("")
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(null)
  const [cardLoading, setCardLoading] = useState(false)
  const [cardView, setCardView] = useState<PosCardView>("loading")
  const [cardCapabilities, setCardCapabilities] = useState<PosCardCapabilities | null>(null)
  const [selectedCardReaderId, setSelectedCardReaderId] = useState("")
  const [cardPaymentLink, setCardPaymentLink] = useState("")
  const [manualClientSecret, setManualClientSecret] = useState("")
  const [manualStripeAccountId, setManualStripeAccountId] = useState("")
  const [manualReturnUrl, setManualReturnUrl] = useState("")
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [availableMethods, setAvailableMethods] = useState<AvailableMethods>({ cash: true, crypto: false, card: false })
  const [cashDigits, setCashDigits] = useState("")
  const [cashRecording, setCashRecording] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const resolvedPaymentIdRef = useRef<string>("")
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hasScheduledResetRef = useRef(false)

  // ── POS Base WC controller ─────────────────────────────────────────────────
  const posBaseRunningRef = useRef(false)
  const posWcProviderRef = useRef<PosWcProvider | null>(null)
  const activePaymentIdRef = useRef("")

  const subtotalNum = digitsToNumber(digits)
  const displayAmount = digitsToDisplay(digits)

  useEffect(() => {
    onLockControlVisibilityChange?.(status === "ready" && paymentMode === null)
    return () => onLockControlVisibilityChange?.(false)
  }, [onLockControlVisibilityChange, paymentMode, status])

  function resetSale() {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
    hasScheduledResetRef.current = false
    // Tear down any active POS Base WC session
    posBaseRunningRef.current = false
    if (posWcProviderRef.current) {
      posWcProviderRef.current.disconnect().catch(() => null)
      posWcProviderRef.current = null
    }
    setDigits("")
    setStatus("ready")
    setQrCodeUrl("")
    setIntentId("")
    setActivePaymentId("")
    activePaymentIdRef.current = ""
    setPaymentError("")
    setPaymentMode(null)
    setCardLoading(false)
    setCardView("loading")
    setCardCapabilities(null)
    setSelectedCardReaderId("")
    setCardPaymentLink("")
    setManualClientSecret("")
    setManualStripeAccountId("")
    setManualReturnUrl("")
    setBreakdown(null)
    setCashDigits("")
    setCashRecording(false)
    setAvailableMethods({ cash: true, crypto: false, card: false })
    resolvedPaymentIdRef.current = ""
  }

  async function cancelSale() {
    if (paymentMode === "card" && activePaymentId) {
      setCanceling(true)
      try {
        await fetch(`/api/payments/stripe/terminal/${encodeURIComponent(activePaymentId)}/cancel`, {
          method: "POST",
          headers: posAuthHeaders(terminalContext?.sessionToken),
        })
      } finally {
        setCanceling(false)
      }
    } else if (intentId) {
      setCanceling(true)
      try {
        const response = await fetch(`/api/payment-intents/${encodeURIComponent(intentId)}/cancel`, {
          method: "POST",
          headers: posAuthHeaders(terminalContext?.sessionToken),
        })
        if (!response.ok) throw new Error("Unable to cancel sale")
      } catch {
        return
        // best-effort — always reset local state even if the API call fails
      } finally {
        setCanceling(false)
      }
    }
    resetSale()
  }

  function applyPaymentStatus(dbStatus: string, sourcePaymentId?: string) {
    if (sourcePaymentId && activePaymentIdRef.current && sourcePaymentId !== activePaymentIdRef.current) {
      return
    }

    const next = resolveUiStatus(dbStatus)
    if (!next) return

    setStatus(next)

    if (paymentMode === "card") {
      if (next === "processing") setCardView("processing")
      if (next === "confirmed") setCardView("approved")
      if (next === "failed" || next === "incomplete" || next === "expired") setCardView("declined")
    }

    if (paymentMode !== "card" && (next === "confirmed" || next === "failed" || next === "incomplete" || next === "expired")) {
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

  useEffect(() => {
    const url = new URL(window.location.href)
    const returnedManualPaymentId = String(url.searchParams.get("manual_payment") || "").trim()
    if (!returnedManualPaymentId) return
    activePaymentIdRef.current = returnedManualPaymentId
    setActivePaymentId(returnedManualPaymentId)
    setPaymentMode("card")
    setStatus("processing")
    setCardView("processing")
    url.searchParams.delete("manual_payment")
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
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

    if (!pollParam || (status !== "waiting" && status !== "processing")) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/status?${pollParam}`)
        if (!res.ok) return
        const data = await res.json() as {
          status?: string
          paymentId?: string
        }
        // If polling by intent and we just learned the paymentId, store it so
        // the direct-payment realtime subscription can start (and future polls
        // use the faster paymentId path).
        if (!pid && data.paymentId) {
          const nextPaymentId = String(data.paymentId)
          activePaymentIdRef.current = nextPaymentId
          setActivePaymentId(nextPaymentId)
        }
        applyPaymentStatus(String(data?.status || ""), pid || String(data.paymentId || ""))
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
          applyPaymentStatus(String(payload.new.status || ""), activePaymentId)
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
      if (paymentChannel) {
        supabase.removeChannel(paymentChannel)
        paymentChannel = null
      }
      resolvedPaymentIdRef.current = pid
      activePaymentIdRef.current = pid
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
            applyPaymentStatus(String(payload.new.status || ""), pid)
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
     POS BASE WC FLOW
     Detects when the customer selects Base on the hosted checkout, then
     creates and owns the WalletConnect session from the terminal side.
  ========================= */

  async function updatePosBaseSession(
    iid: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    try {
      await fetch(`/api/pos/base-session/${encodeURIComponent(iid)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...posAuthHeaders(terminalContext?.sessionToken),
        },
        body: JSON.stringify(updates),
      })
    } catch {
      // best-effort — session updates are informational
    }
  }

  async function isCurrentBasePayment(iid: string, paymentId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/payment-intents/${encodeURIComponent(iid)}`, { cache: "no-store" })
      if (!res.ok) return false
      const data = (await res.json()) as {
        selectedNetwork?: string | null
        paymentId?: string | null
      }
      return (
        String(data.selectedNetwork || "").toLowerCase() === "base" &&
        String(data.paymentId || "") === paymentId
      )
    } catch {
      return false
    }
  }

  async function abandonPosBaseAttempt(iid: string): Promise<void> {
    await updatePosBaseSession(iid, { clear: true })
  }

  function createBasePaymentSupersededWatcher(iid: string, paymentId: string): {
    cancel: () => void
    promise: Promise<never>
  } {
    let interval: number | null = null
    const promise = new Promise<never>((_, reject) => {
      interval = window.setInterval(() => {
        void isCurrentBasePayment(iid, paymentId).then((isCurrent) => {
          if (isCurrent) return
          if (interval !== null) window.clearInterval(interval)
          interval = null
          reject(new Error("Base payment attempt abandoned"))
        })
      }, 1000)
    })
    return {
      cancel: () => {
        if (interval !== null) window.clearInterval(interval)
        interval = null
      },
      promise,
    }
  }

  async function runPosBaseFlow(
    paymentId: string,
    iid: string,
    asset: "ETH" | "USDC",
    paymentUrl: string
  ): Promise<void> {
    let finalTxHashSubmitted = false
    try {
      console.log("[POS Base WC] session_created", { intentId: iid, paymentId, asset })
      await updatePosBaseSession(iid, { step: "awaiting_wallet", selectedAsset: asset })

      const wcResult = await initPosBaseWalletConnect()
      if (!wcResult.ok) throw new Error(wcResult.error)

      posWcProviderRef.current = wcResult.provider

      console.log("[POS Base WC] pairing_uri_published", { intentId: iid, paymentId, asset })
      await updatePosBaseSession(iid, {
        step: "awaiting_wallet",
        pairingUri: wcResult.pairingUri,
        selectedAsset: asset,
      })

      // Wait for customer to open the wallet deep-link and approve pairing
      const supersededWatcher = createBasePaymentSupersededWatcher(iid, paymentId)
      const walletAddress = await Promise.race([
        waitForWalletConnect(wcResult.provider),
        supersededWatcher.promise,
      ]).finally(() => supersededWatcher.cancel())
      if (!(await isCurrentBasePayment(iid, paymentId))) {
        await abandonPosBaseAttempt(iid)
        return
      }
      const maskedAddress = walletAddress
        ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
        : ""

      console.log("[POS Base WC] wallet_connected", { intentId: iid, paymentId, asset, maskedAddress })
      await updatePosBaseSession(iid, {
        step: "wallet_connected",
        walletAddressMasked: maskedAddress,
      })

      await updatePosBaseSession(iid, { step: "payment_sending" })
      if (!(await isCurrentBasePayment(iid, paymentId))) {
        await abandonPosBaseAttempt(iid)
        return
      }

      let txHash: string

      if (asset === "ETH") {
        const parsed = parseEthereumUri(paymentUrl)
        if (!parsed) throw new Error("Invalid Base ETH payment URI")

        console.log("[POS Base ETH] request_start", { paymentId })
        // from is required by WalletConnect v2 to route to the correct account
        const rawTxHash = await wcResult.provider.request<string>({
          method: "eth_sendTransaction",
          params: [{ from: walletAddress, to: parsed.to, value: parsed.valueHex, data: parsed.data, chainId: "0x2105" }],
        })
        console.log("[POS Base ETH] request_resolved", { paymentId, hasTxHash: Boolean(rawTxHash) })

        if (typeof rawTxHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(rawTxHash)) {
          throw new Error("Wallet did not return a valid ETH transaction hash")
        }
        txHash = rawTxHash
        console.log("[POS Base ETH] tx_hash_captured", {
          paymentId,
          txHashPrefix: txHash.slice(0, 10),
          txHashSuffix: txHash.slice(-6),
        })

      } else {
        // ── USDC: resolve V7 strategy, try EIP-3009 relayer, fall back to allowance ──
        console.log("[POS Base USDC V7] strategy_selected", { paymentId })
        const strategyRes = await fetch(
          `/api/payments/${encodeURIComponent(paymentId)}/base-v7/strategy`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payerAddress: walletAddress,
              walletCapabilities: {
                walletFamily: "walletconnect",
                supportsTypedData: true,
                supportsSendCalls: false,
                skipEip3009: false,
                skipDelegatedBatch: true,
              },
            }),
          }
        )
        const strategyData = (await strategyRes.json()) as {
          ok: boolean
          strategy?: string
          error?: string
        }
        if (!strategyData.ok) throw new Error(strategyData.error || "Strategy resolution failed")
        console.log("[POS Base USDC V7] strategy_selected", { paymentId, strategy: strategyData.strategy })

        // Try EIP-3009 relayer path; on non-rejection failure fall back to allowance path
        let usdcTxHash: string | undefined

        if (strategyData.strategy === "usdc_eip3009_relayer") {
          try {
            usdcTxHash = await executePosBaseEip3009(paymentId, walletAddress, wcResult.provider)
          } catch (eip3009Err) {
            const errMsg = eip3009Err instanceof Error ? eip3009Err.message : String(eip3009Err)
            const isUserRejection =
              /reject|cancel|denied|user denied/i.test(errMsg) ||
              (eip3009Err as { code?: number })?.code === 4001
            if (isUserRejection) {
              console.log("[POS Base WC] request_rejected", { paymentId, asset: "USDC", errorCode: "wallet_rejected" })
              throw eip3009Err
            }
            // Non-rejection error (e.g. wallet doesn't support eth_signTypedData_v4): fall back
            console.warn("[POS Base WC] request_failed", {
              paymentId,
              asset: "USDC",
              errorCode: "eip3009_failed_fallback",
              error: errMsg,
            })
            // usdcTxHash remains undefined — allowance path runs below
          }
        }

        if (usdcTxHash === undefined) {
          usdcTxHash = await executePosBaseAllowancePath(paymentId, walletAddress, wcResult.provider)
        }

        txHash = usdcTxHash
        console.log("[POS Base USDC V7] detect_start", {
          paymentId,
          txHashPrefix: txHash.slice(0, 10),
          txHashSuffix: txHash.slice(-6),
        })
      }

      await updatePosBaseSession(iid, { step: "payment_submitted" })
      finalTxHashSubmitted = true

      const detectPrefix = asset === "ETH" ? "[POS Base ETH]" : "[POS Base USDC]"
      console.log(`${detectPrefix} detect_start`, { paymentId, txHashPrefix: txHash.slice(0, 10) })
      const detectRes = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      }).catch((detectErr) => {
        console.error(`${detectPrefix} detect_start_failed`, {
          paymentId,
          error: detectErr instanceof Error ? detectErr.message : String(detectErr),
        })
        return null
      })
      console.log(`${detectPrefix} detect_resolved`, {
        paymentId,
        status: detectRes?.status ?? "network_error",
      })

      await updatePosBaseSession(iid, { step: "confirming" })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment failed"
      const isRejection =
        /reject|cancel|denied|user denied/i.test(message) ||
        (err as { code?: number })?.code === 4001
      const isAbandonedBeforeFinalTx =
        !finalTxHashSubmitted &&
        (isRejection || /base payment attempt abandoned|timed out waiting for wallet to connect|wallet disconnected/i.test(message))
      console.log(
        isRejection ? "[POS Base WC] request_rejected" : "[POS Base WC] request_failed",
        {
          intentId: iid,
          paymentId,
          asset,
          errorCode: isRejection ? "wallet_rejected" : "wallet_request_failed",
          error: message,
        }
      )
      const stillCurrentBasePayment = await isCurrentBasePayment(iid, paymentId)
      if (isAbandonedBeforeFinalTx || !stillCurrentBasePayment) {
        await abandonPosBaseAttempt(iid)
        return
      }
      setPaymentError(message)
      await updatePosBaseSession(iid, { step: "failed", errorMessage: message }).catch(() => null)
      setStatus("failed")
    } finally {
      posBaseRunningRef.current = false
      if (posWcProviderRef.current) {
        posWcProviderRef.current.disconnect().catch(() => null)
        posWcProviderRef.current = null
      }
    }
  }

  // Detect when the customer selects Base on the hosted checkout.
  // Polls the intent every 3 s until selectedNetwork=base is confirmed, then
  // starts the POS-owned WalletConnect flow. A one-shot check misses cases
  // where the DB write for selectedNetwork races with the realtime paymentId event.
  useEffect(() => {
    if (!intentId) return
    if (posBaseRunningRef.current) return

    let cancelled = false
    const POLL_MS = 3000
    const TIMEOUT_MS = 10 * 60 * 1000
    const startedAt = Date.now()

    const poll = async (): Promise<void> => {
      if (cancelled || posBaseRunningRef.current) return
      if (Date.now() - startedAt > TIMEOUT_MS) return

      try {
        const res = await fetch(
          `/api/payment-intents/${encodeURIComponent(intentId)}`,
          { cache: "no-store" }
        )
        if (!res.ok || cancelled || posBaseRunningRef.current) return
        const data = (await res.json()) as {
          selectedNetwork?: string | null
          selectedAsset?: string | null
          paymentUrl?: string | null
          paymentId?: string | null
        }

        // Sync paymentId to state if realtime missed it
        const pid = String(data.paymentId || "").trim()
        if (pid) {
          activePaymentIdRef.current = pid
          setActivePaymentId(pid)
        }

        const net = String(data.selectedNetwork || "").toLowerCase()
        if (net === "base" && pid && !cancelled && !posBaseRunningRef.current) {
          const asset =
            String(data.selectedAsset || "ETH").toUpperCase() === "USDC" ? "USDC" : "ETH"
          const paymentUrl = String(data.paymentUrl || "")
          posBaseRunningRef.current = true
          void runPosBaseFlow(pid, intentId, asset, paymentUrl)
          return
        }
      } catch {
        // non-fatal — retry
      }

      if (!cancelled && !posBaseRunningRef.current) {
        await new Promise<void>((r) => setTimeout(r, POLL_MS))
        void poll()
      }
    }

    void poll()
    return () => { cancelled = true }
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
      setPaymentMode("crypto")
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
        activePaymentIdRef.current = returnedPaymentId
        setActivePaymentId(returnedPaymentId)
      }

      if (data.qrCodeUrl) {
        setQrCodeUrl(data.qrCodeUrl)
      }

    } catch {
      setStatus("failed")
    }
  }

  async function startCard() {
    if (!digits || subtotalNum <= 0) return
    if (!availableMethods.card) {
      setPaymentError("Card payments are not ready yet.")
      setStatus("failed")
      return
    }

    try {
      setPaymentError("")
      setPaymentMode("card")
      setCardLoading(true)
      setStatus("waiting")
      setCardView("loading")

      await loadCardCapabilities(true)
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Unable to load Stripe Card Readers.")
      setCardView("no-reader")
    } finally {
      setCardLoading(false)
    }
  }

  async function loadCardCapabilities(refresh = false) {
    setPaymentError("")
    setCardLoading(true)
    const endpoint = refresh
      ? "/api/providers/stripe/terminal/readers"
      : "/api/providers/stripe/card-capabilities"
    if (refresh) {
      const refreshResponse = await fetch(endpoint, { headers: posAuthHeaders(terminalContext?.sessionToken) })
      if (!refreshResponse.ok) {
        const refreshPayload = await refreshResponse.json().catch(() => null)
        throw new Error(refreshPayload?.error || "Unable to refresh Stripe Card Readers.")
      }
    }
    const capabilityResponse = await fetch("/api/providers/stripe/card-capabilities", {
      headers: posAuthHeaders(terminalContext?.sessionToken),
    })
    const capabilities = await capabilityResponse.json().catch(() => null) as PosCardCapabilities | null
    if (!capabilityResponse.ok || !capabilities) throw new Error("Unable to load Stripe Card Reader availability.")
    setCardCapabilities(capabilities)
    const reader = capabilities.terminalReaders.find(item => item.id === selectedCardReaderId && item.status === "online")
      || capabilities.terminalReaders.find(item => item.isDefault && item.status === "online")
      || capabilities.terminalReaders.find(item => item.status === "online")
    setSelectedCardReaderId(reader?.id || "")
    setCardView(reader ? "collect" : "no-reader")
    setCardLoading(false)
  }

  async function sendToCardReader() {
    const reader = cardCapabilities?.terminalReaders.find(item => item.id === selectedCardReaderId && item.status === "online")
    if (!reader) {
      setCardView("no-reader")
      setPaymentError("Select an online Stripe Card Reader.")
      return
    }
    setCardLoading(true)
    setPaymentError("")
    try {
      const res = await fetch("/api/payments/stripe/terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...posAuthHeaders(terminalContext?.sessionToken),
        },
        body: JSON.stringify({
          amount: subtotalNum,
          currency: "USD",
          readerId: reader.id,
        }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data) {
        throw new Error(data?.error || "Card payments are not ready yet.")
      }

      const returnedPaymentId = String(data.paymentId || "").trim()
      if (!returnedPaymentId) throw new Error("Unable to send this payment to the reader.")
      activePaymentIdRef.current = returnedPaymentId
      setActivePaymentId(returnedPaymentId)
      setCardView("waiting")
      if (reader.simulated) {
        const simulationResponse = await fetch("/api/providers/stripe/terminal/readers/simulate-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...posAuthHeaders(terminalContext?.sessionToken),
          },
          body: JSON.stringify({ paymentId: returnedPaymentId }),
        })
        if (!simulationResponse.ok) {
          const simulationPayload = await simulationResponse.json().catch(() => null)
          throw new Error(simulationPayload?.error || "Unable to present the Sandbox Reader test card.")
        }
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Unable to send the payment to the reader.")
      setCardView("collect")
    } finally {
      setCardLoading(false)
    }
  }

  async function startManualEntry(paymentId?: string) {
    setPaymentError("")
    setPaymentMode("card")
    setManualClientSecret("")
    setManualStripeAccountId("")
    setCardView("manual")
    const response = await fetch("/api/payments/stripe/manual", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...posAuthHeaders(terminalContext?.sessionToken),
      },
      body: JSON.stringify({
        paymentId: paymentId || undefined,
        amount: subtotalNum,
        currency: "USD",
      }),
    })
    const payload = await response.json().catch(() => null) as {
      error?: string
      paymentId?: string
      clientSecret?: string
      stripeAccountId?: string
    } | null
    if (!response.ok || !payload?.paymentId || !payload.clientSecret || !payload.stripeAccountId) {
      throw new Error(payload?.error || "Unable to prepare manual card entry.")
    }
    activePaymentIdRef.current = payload.paymentId
    setActivePaymentId(payload.paymentId)
    setManualClientSecret(payload.clientSecret)
    setManualStripeAccountId(payload.stripeAccountId)
    const returnUrl = new URL(window.location.href)
    returnUrl.searchParams.set("manual_payment", payload.paymentId)
    setManualReturnUrl(returnUrl.toString())
    setSelectedCardReaderId("")
    setStatus("waiting")
  }

  async function registerCardReader(registrationCode: string, label: string) {
    setCardLoading(true)
    setPaymentError("")
    try {
      const headers = posAuthHeaders(terminalContext?.sessionToken)
      const locationsResponse = await fetch("/api/providers/stripe/terminal/locations", { headers })
      const locationsPayload = await locationsResponse.json().catch(() => null) as { locations?: Array<{ id: string }>; error?: string } | null
      const terminalLocationId = locationsPayload?.locations?.[0]?.id
      if (!locationsResponse.ok || !terminalLocationId) {
        setCardView("setup")
        throw new Error(locationsPayload?.error || "Create a Stripe Terminal Location before registering a physical reader.")
      }
      const response = await fetch("/api/providers/stripe/terminal/readers/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ registrationCode, label, terminalLocationId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || "Unable to register this Stripe Card Reader.")
      await loadCardCapabilities(true)
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Unable to register this Stripe Card Reader.")
    } finally {
      setCardLoading(false)
    }
  }

  async function createPosTerminalLocation(input: {
    displayName: string
    address: { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string }
  }) {
    setCardLoading(true)
    setPaymentError("")
    try {
      const response = await fetch("/api/providers/stripe/terminal/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...posAuthHeaders(terminalContext?.sessionToken) },
        body: JSON.stringify(input),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.location) throw new Error(payload?.error || "Unable to create this Stripe Terminal Location.")
      await loadCardCapabilities()
      setCardView("setup")
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Unable to create this Stripe Terminal Location.")
      setCardView("setup")
    } finally {
      setCardLoading(false)
    }
  }

  async function createSandboxCardReader() {
    const terminalLocationId = cardCapabilities?.terminalLocations[0]?.id
    if (!terminalLocationId) {
      setPaymentError("")
      setCardView("setup")
      return
    }

    setCardLoading(true)
    setPaymentError("")
    try {
      const response = await fetch("/api/providers/stripe/terminal/readers/simulated", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...posAuthHeaders(terminalContext?.sessionToken) },
        body: JSON.stringify({ terminalLocationId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.reader) throw new Error(payload?.error || "Unable to create a Sandbox Reader.")
      await loadCardCapabilities(true)
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Unable to create a Sandbox Reader.")
      setCardView("no-reader")
    } finally {
      setCardLoading(false)
    }
  }

  async function sendCardPaymentLink() {
    setCardView("payment-link")
    setCardPaymentLink("")
    setPaymentError("")
    try {
      const response = await fetch("/api/pos/card/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...posAuthHeaders(terminalContext?.sessionToken) },
        body: JSON.stringify({ amount: subtotalNum, currency: "USD", network: "stripe" }),
      })
      const payload = await response.json().catch(() => null) as { paymentUrl?: string; error?: string } | null
      if (!response.ok || !payload?.paymentUrl) throw new Error(payload?.error || "Unable to create a payment link.")
      setCardPaymentLink(payload.paymentUrl)
      if (navigator.share) await navigator.share({ title: `Pay ${displayTotal}`, url: payload.paymentUrl }).catch(() => undefined)
      else await navigator.clipboard?.writeText(payload.paymentUrl).catch(() => undefined)
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Unable to create a payment link.")
    }
  }

  const displayTotal = breakdown
    ? fmtUsd(breakdown.totalAmount)
    : fmtUsd(subtotalNum)

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-hidden px-0">

      <div className={`${paymentMode === "card" ? "bg-[#F4F8FF]" : "bg-white"} max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1.5rem)] w-full max-w-[420px] overflow-y-auto overscroll-contain rounded-2xl p-4 shadow-lg sm:p-6`}>

        {/* ── READY ── */}
        {status === "ready" && (
          <div className="space-y-4">
            <AmountDisplay amount={displayAmount} />
            <Keypad digits={digits} setDigits={setDigits} showDecimal />
            <div className="mx-auto mt-2 max-w-[340px]">
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
                  <span>Service fee</span>
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
                    disabled={!availableMethods.card || cardLoading}
                    onClick={() => void startCard()}
                  >
                    {cardLoading ? "Preparing card payment…" : "Card"}
                  </Button>
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
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-blue-600">Confirmed</p>
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
              className="mx-auto h-9 w-full max-w-[280px]"
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
                      subtotalAmount: breakdown?.subtotalAmount ?? totalDue,
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
              {cashRecording ? "Recording..." : "Done"}
            </Button>

          </div>
        )}

        {/* ── WAITING / PROCESSING ── */}
        {paymentMode === "card" && (
          <PosCardPaymentExperience
            amount={displayTotal}
            view={cardView}
            capabilities={cardCapabilities}
            selectedReaderId={selectedCardReaderId}
            loading={cardLoading || canceling}
            error={paymentError}
            paymentLink={cardPaymentLink}
            paymentId={activePaymentId}
            manualClientSecret={manualClientSecret}
            manualStripeAccountId={manualStripeAccountId}
            manualReturnUrl={manualReturnUrl}
            onSelectReader={setSelectedCardReaderId}
            onSendToReader={() => void sendToCardReader()}
            onRefreshReaders={() => void loadCardCapabilities(true).catch(error => {
              setPaymentError(error instanceof Error ? error.message : "Unable to refresh Stripe Card Readers.")
              setCardLoading(false)
              setCardView("no-reader")
            })}
            onOpenSetup={() => { setPaymentError(""); setCardView("setup") }}
            onCreateLocation={createPosTerminalLocation}
            onCreateSandboxReader={() => void createSandboxCardReader()}
            onOpenRegister={() => { setPaymentError(""); setCardView("register") }}
            onRegisterReader={registerCardReader}
            onOpenManual={() => void startManualEntry().catch(error => setPaymentError(error instanceof Error ? error.message : "Unable to prepare manual card entry."))}
            onManualSuccess={() => { setStatus("processing"); setCardView("processing") }}
            onManualError={setPaymentError}
            onSendPaymentLink={() => void sendCardPaymentLink()}
            onTryAgain={() => { setActivePaymentId(""); activePaymentIdRef.current = ""; void loadCardCapabilities() }}
            onBack={() => { setPaymentError(""); setCardView(cardCapabilities?.terminalReaders.some(reader => reader.status === "online") ? "collect" : "no-reader") }}
            onCancel={() => void cancelSale()}
            onDone={resetSale}
            onViewReceipt={() => window.open(`/api/receipts/${encodeURIComponent(activePaymentId)}`, "_blank", "noopener,noreferrer")}
          />
        )}

        {paymentMode !== "card" && (status === "waiting" || status === "processing") && (
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
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Preparing payment…
                </p>
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
                  <span>Service fee</span>
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
        {paymentMode !== "card" && status === "confirmed" && (
          <div className="py-3">
            <PaymentStatusVisual status="CONFIRMED" variant="card" />
          </div>
        )}

        {/* ── INCOMPLETE ── */}
        {paymentMode !== "card" && status === "incomplete" && (
          <div className="flex flex-col items-center gap-3 py-3">
            <PaymentStatusVisual status="INCOMPLETE" variant="card" />
            <Button variant="secondary" fullWidth onClick={resetSale}>
              Back
            </Button>
          </div>
        )}

        {/* ── FAILED ── */}
        {paymentMode !== "card" && status === "failed" && (
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
        {paymentMode !== "card" && status === "expired" && (
          <div className="flex flex-col items-center gap-3 py-3">
            <PaymentStatusVisual status="EXPIRED" variant="card" />
            <Button variant="secondary" fullWidth onClick={resetSale}>
              Back
            </Button>
          </div>
        )}


      </div>

    </div>
  )
}
