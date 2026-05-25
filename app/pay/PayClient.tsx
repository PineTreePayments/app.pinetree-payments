"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createBrowserClient } from "@supabase/ssr"
import { ALLOWED_ASSETS, getAvailableAssetsFromValues } from "@/engine/providerMappings"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import PageContainer from "@/components/ui/PageContainer"
import BaseWalletPayment from "@/components/payment/BaseWalletPayment"
import SolanaWalletPayment from "@/components/payment/SolanaWalletPayment"
import LightningPayment from "@/components/payment/LightningPayment"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
import {
  buildSignAndSendUrl,
  clearSolflareSession,
  consumePendingPaymentId,
  decryptConnectResponse,
  decryptSignResponse,
  getStoredSession,
  storeSession,
} from "@/lib/solflareDeeplink"
import {
  getInjectedPhantomProvider,
  getSolanaProviderPublicKey,
  getSolanaTransactionSignature,
} from "@/lib/wallets/solana"

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const PHANTOM_PROVIDER_RETRY_TIMEOUT_MS = 4000
const PHANTOM_PROVIDER_RETRY_INTERVAL_MS = 150
const BASE_WC_PENDING_KEY = "pinetree_base_wc_pending"
const BASE_EXEC_STORAGE_PREFIX = "pinetree_base_exec_"
const TERMINAL_PAYMENT_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])

type SplitOutput = {
  address: string
  amount: number
}

type SplitPayload = {
  type?: string
  network?: string
  reference?: string
  outputs?: SplitOutput[]
  paymentUrl?: string
  walletUrl?: string
  universalUrl?: string
  walletOptions?: WalletOption[]
  totalAmount?: number
  usdTotalAmount?: number
  nativeAmount?: number
  nativeSymbol?: string
  quotePriceUsd?: number | null
  redirect?: string
}

type IntentPayload = {
  intentId: string
  amount: number
  currency: string
  pinetreeFee: number
  availableNetworks: string[]
  selectedNetwork?: string | null
  selectedAsset?: string | null
  paymentId?: string | null
  paymentStatus?: string | null
  status?: string | null
  checkoutUrl?: string
  checkoutToken?: string
}

type WalletOption = {
  id: string
  label: string
  url?: string
  href: string
}

type AssetOption = {
  id: string
  label: string
  network: string
  symbol: string
  disabled?: boolean
  disabledCopy?: string
}

type SolanaPayTransactionResponse = {
  transaction?: string
  error?: string
}

function parsePayload(raw: string | null): SplitPayload | null {
  if (!raw) return null

  const candidates = [raw]
  try {
    candidates.push(decodeURIComponent(raw))
  } catch {
    // ignore decode errors
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object") {
        return parsed as SplitPayload
      }
    } catch {
      // try next candidate
    }
  }

  return null
}

function isSolanaPayment(payload: SplitPayload | null): boolean {
  if (!payload) return false
  const network = String(payload.network || "").toLowerCase()
  return network === "solana"
}

function isBaseContractPayment(payload: SplitPayload | null): boolean {
  if (!payload) return false
  const network = String(payload.network || "").toLowerCase()
  const url = String(payload.paymentUrl || "")
  return network === "base" && url.startsWith("ethereum:") && url.includes("data=0x")
}

function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number.isFinite(amount) ? amount : 0)
}

function getSolflareRetryMessage(code: string | null): string {
  if (!code) return ""
  return "Solflare connection could not be completed. Please try again."
}

function getPhantomRetryMessage(code: string | null): string {
  if (!code) return ""
  if (code === "not_detected") {
    return "Phantom could not be detected after opening the wallet. Please open this page in Phantom or install Phantom, then try again."
  }
  return "Phantom connection could not be completed. Please try again."
}

function normalizeTerminalPaymentStatus(status: string): string {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "CANCELLED") return "CANCELED"
  return normalized
}

function isTerminalPaymentStatus(status: string): boolean {
  return TERMINAL_PAYMENT_STATUSES.has(normalizeTerminalPaymentStatus(status))
}

function clearStaleBaseExecutionSessionStorage(): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(BASE_WC_PENDING_KEY)
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith(BASE_EXEC_STORAGE_PREFIX)) {
        window.sessionStorage.removeItem(key)
      }
    }
  } catch {
    // Session storage cleanup is best-effort only.
  }
}

async function logSolflare(
  stage: string,
  payload: Record<string, unknown>,
): Promise<void> {
  console.log("[Solflare DEBUG]", stage, payload)
  await fetch("/api/debug/solflare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage, payload }),
  }).catch(() => null)
}

async function waitForInjectedPhantomProvider() {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= PHANTOM_PROVIDER_RETRY_TIMEOUT_MS) {
    const provider = getInjectedPhantomProvider()
    if (provider) return provider

    await new Promise((resolve) => {
      window.setTimeout(resolve, PHANTOM_PROVIDER_RETRY_INTERVAL_MS)
    })
  }

  return null
}

function getCheckoutAssetOptions(networks: string[]): AssetOption[] {
  const availableAssets = getAvailableAssetsFromValues(networks)

  return availableAssets.map((assetId) => {
    const asset = ALLOWED_ASSETS[assetId]

    return {
      id: assetId,
      label: asset.label,
      network: asset.network,
      symbol: asset.symbol
    }
  })
}

export default function PayClient() {
  const searchParams = useSearchParams()
  const rawData = searchParams.get("data")
  const intentId = searchParams.get("intent")
  const walletBrowserPaymentId = searchParams.get("pinetree_payment_id")
  const walletBrowserMode = searchParams.get("mode")
  const walletBrowserWallet = searchParams.get("wallet")
  const statusOverride = searchParams.get("status")
  // POS-terminal-controlled Base payments: status-only follow-along mode.
  // ?paymentId=<id>&mode=status[&asset=ETH|USDC]
  const posStatusPaymentId = searchParams.get("paymentId")
  const posStatusAsset = (searchParams.get("asset") || "").toUpperCase()
  const isPosStatusMode = walletBrowserMode === "status" && Boolean(posStatusPaymentId)
  const solflareAction = searchParams.get("solflare_action")
  const solflareError = searchParams.get("solflare_error")
  const phantomError = searchParams.get("phantom_error")
  const successUrl = searchParams.get("success_url")
  const cancelUrl = searchParams.get("cancel_url")
  const isWalletBrowserMode =
    walletBrowserMode === "wallet-browser" &&
    walletBrowserWallet === "phantom" &&
    Boolean(walletBrowserPaymentId)
  const isSolflareCallbackMode =
    solflareAction === "connect_callback" || solflareAction === "sign_callback"

  // ── Shared clipboard state ─────────────────────────────────────────────────
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [copiedAmount, setCopiedAmount] = useState(false)

  // ── Intent mode state ──────────────────────────────────────────────────────
  const [selectedAssetId, setSelectedAssetId] = useState<string>("")
  const [paymentStatus, setPaymentStatus] = useState<string>("")
  const [intentPayload, setIntentPayload] = useState<IntentPayload | null>(null)
  const [intentLoadError, setIntentLoadError] = useState<string>("")
  // Checkout session token — scoped to the current intent, used to authorise
  // customer-initiated cancellation (/fail) without merchant credentials.
  // Stored in a ref so useEffect closures (Phantom, Solflare) always see the
  // latest value without requiring effect re-registration.
  const [checkoutToken, setCheckoutToken] = useState<string>("")
  const checkoutTokenRef = useRef<string>("")

  // ── Shift4 redirect state (inline — no dedicated component needed) ─────────
  const [shift4Loading, setShift4Loading] = useState(false)
  const [shift4Error, setShift4Error] = useState("")

  // ── POS status-only mode ───────────────────────────────────────────────────
  const [posPaymentStatus, setPosPaymentStatus] = useState("")
  const [posStatusLoaded, setPosStatusLoaded] = useState(false)

  // ── Base execution: once Base payment starts, collapse asset selector ──────
  const [baseExecutionActive, setBaseExecutionActive] = useState(false)
  const [solanaExecutionActive, setSolanaExecutionActive] = useState(false)

  const handleBaseCancelPayment = useCallback(() => {
    setBaseExecutionActive(false)
    setSelectedAssetId("")
  }, [])

  const handleSolanaCancelPayment = useCallback(() => {
    setSolanaExecutionActive(false)
    setSelectedAssetId("")
  }, [])

  const handleLightningCancelPayment = useCallback(() => {
    setSelectedAssetId("")
  }, [])

  // ── Direct-payload mode state (non-intent, legacy QR) ─────────────────────
  const payload = useMemo(() => parsePayload(rawData), [rawData])
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null)
  const [selectedWalletId, setSelectedWalletId] = useState("")
  const [paymentPayload, setPaymentPayload] = useState<SplitPayload | null>(null)

  const activePayload = paymentPayload || payload
  const walletUrl = String(
    activePayload?.walletUrl ||
      activePayload?.universalUrl ||
      activePayload?.paymentUrl ||
      ""
  )
  const walletOptions = useMemo(
    () => (Array.isArray(activePayload?.walletOptions) ? activePayload.walletOptions : []),
    [activePayload]
  )
  const resolvedSelectedWalletId = useMemo(() => {
    return walletOptions.some((option) => option.id === selectedWalletId)
      ? selectedWalletId
      : ""
  }, [walletOptions, selectedWalletId])
  const selectedWallet = useMemo(
    () => walletOptions.find((option) => option.id === resolvedSelectedWalletId) || null,
    [walletOptions, resolvedSelectedWalletId]
  )
  const recipientAddress = String(activePayload?.outputs?.[0]?.address || "")
  const primaryOpenUrl =
    selectedWallet?.href ||
    String(activePayload?.universalUrl || activePayload?.paymentUrl || walletUrl || "")

  const normalizedPaymentStatus = String(paymentStatus || "").toUpperCase()
  const isIntentMode = Boolean(intentId && intentPayload)
  const normalizedStatusOverride = normalizeTerminalPaymentStatus(statusOverride || "")
  const terminalPaymentStatus = isTerminalPaymentStatus(normalizedPaymentStatus)
    ? normalizedPaymentStatus
    : normalizedStatusOverride === "FAILED" || normalizedStatusOverride === "CANCELED"
      ? normalizedStatusOverride
      : ""
  const intentCardsRef = useRef<HTMLDivElement | null>(null)

  // ── Intent mode helpers ────────────────────────────────────────────────────

  async function loadIntent() {
    if (!intentId) return
    try {
      const res = await fetch(`/api/payment-intents/${encodeURIComponent(intentId)}`, { cache: "no-store" })
      const data = (await res.json()) as IntentPayload | { error?: string }
      if (!res.ok || ("error" in data && data.error)) {
        const msg = ("error" in data && data.error) ? String(data.error) : "Payment not found"
        setIntentLoadError(msg)
        return
      }
      const intent = data as IntentPayload
      setIntentPayload(intent)
      setIntentLoadError("")
      if (intent.checkoutToken) {
        setCheckoutToken(intent.checkoutToken)
        checkoutTokenRef.current = intent.checkoutToken
      }
      // If the intent itself was expired (merchant cancel) and no payment was
      // ever created, synthesize CANCELED so the terminal-status screen fires.
      if (intent.status === "EXPIRED" && !intent.paymentId) {
        setPaymentStatus("CANCELED")
      } else {
        setPaymentStatus(String(intent.paymentStatus || ""))
      }
      const selectedNetwork = String(intent.selectedNetwork || "").toLowerCase()
      const selectedAsset = String(intent.selectedAsset || "").toUpperCase()
      const activeStatus = String(intent.paymentStatus || "").toUpperCase()
      if (
        selectedNetwork === "solana" &&
        intent.paymentId &&
        (activeStatus === "CREATED" || activeStatus === "PENDING" || activeStatus === "PROCESSING")
      ) {
        setSelectedAssetId(selectedAsset === "USDC" ? "sol-usdc" : "sol")
        // Only collapse the asset selector when a tx is actually in flight (PROCESSING).
        // CREATED/PENDING means the user selected Solana but may not have submitted a tx yet;
        // keeping the selector open lets them retry or switch rails without being trapped.
        if (activeStatus === "PROCESSING") {
          setSolanaExecutionActive(true)
        }
      }
    } catch {
      setIntentLoadError("Unable to load payment. Please try again.")
    }
  }

  const loadIntentCallback = useCallback(loadIntent, [intentId])

  // Asset selection: pure UI — no API calls, no payment creation
  function selectAsset(assetId: string) {
    if (selectedAssetId === assetId) {
      setSelectedAssetId("")
      setShift4Error("")
      return
    }
    setSelectedAssetId(assetId)
    setShift4Error("")
  }

  // Shift4: create payment + redirect to hosted checkout on button click
  const handleShift4Pay = useCallback(async () => {
    if (!intentId) return
    if (!checkoutToken) {
      setShift4Error("Checkout session unavailable. Please refresh and try again.")
      return
    }
    setShift4Loading(true)
    setShift4Error("")
    try {
      const res = await fetch(
        `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${checkoutToken}`,
          },
          body: JSON.stringify({ network: "shift4" }),
        }
      )
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error || "Failed to prepare checkout")
      }
      const result = (await res.json()) as { paymentUrl?: string; paymentId?: string }
      if (result.paymentId) {
        void loadIntentCallback()
      }
      const url = String(result.paymentUrl || "")
      if (!url) throw new Error("No checkout URL returned")
      window.location.href = url
    } catch (err) {
      setShift4Error((err as Error).message || "Failed to redirect to checkout")
    } finally {
      setShift4Loading(false)
    }
  }, [intentId, loadIntentCallback])

  // ── Load intent on mount ───────────────────────────────────────────────────

  useEffect(() => {
    if (!intentId) return
    void loadIntentCallback()
  }, [intentId, loadIntentCallback])

  useEffect(() => {
    if (!isIntentMode) return
    if (!terminalPaymentStatus) return

    clearStaleBaseExecutionSessionStorage()
    setBaseExecutionActive(false)
    setSolanaExecutionActive(false)
    setSelectedAssetId("")
  }, [isIntentMode, terminalPaymentStatus])

  // ── Deselect asset when clicking outside the card list ────────────────────

  useEffect(() => {
    if (!selectedAssetId) return
    // Never deselect while Base execution is active — the returning-from-wallet
    // tap would fire mousedown outside intentCardsRef and unmount BaseWalletPayment.
    if (baseExecutionActive || solanaExecutionActive) return

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (intentCardsRef.current && !intentCardsRef.current.contains(target)) {
        setSelectedAssetId("")
        setShift4Error("")
      }
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [selectedAssetId, baseExecutionActive, solanaExecutionActive])

  // Strip solflare_error param from URL after reading so it doesn't persist on reload
  useEffect(() => {
    if (!solflareError) return
    const url = new URL(window.location.href)
    url.searchParams.delete("solflare_error")
    window.history.replaceState({}, "", url.toString())
  }, [solflareError])

  // Strip phantom_error param from URL after reading so it doesn't persist on reload
  useEffect(() => {
    if (!phantomError) return
    const url = new URL(window.location.href)
    url.searchParams.delete("phantom_error")
    window.history.replaceState({}, "", url.toString())
  }, [phantomError])

  // ── POS status-only mode: poll payment status until terminal state ─────────
  useEffect(() => {
    if (!isPosStatusMode || !posStatusPaymentId) return
    let canceled = false
    async function poll() {
      try {
        const res = await fetch(
          `/api/payments/status?paymentId=${encodeURIComponent(posStatusPaymentId!)}`,
          { cache: "no-store" }
        )
        if (!res.ok || canceled) return
        const data = (await res.json()) as { status?: string }
        const next = String(data.status || "").toUpperCase()
        setPosPaymentStatus(next)
        setPosStatusLoaded(true)
      } catch {
        // non-fatal — will retry on next interval
      }
    }
    void poll()
    const handle = setInterval(() => void poll(), 5000)
    return () => { canceled = true; clearInterval(handle) }
  }, [isPosStatusMode, posStatusPaymentId])

  // ── Poll intent status once a payment has been created ────────────────────

  useEffect(() => {
    if (!intentId) return
    if (!intentPayload?.paymentId) return
    const isTerminal = isTerminalPaymentStatus(normalizedPaymentStatus)
    if (isTerminal) return

    const interval = setInterval(() => {
      void loadIntentCallback()
    }, 5000)

    return () => clearInterval(interval)
  }, [intentId, loadIntentCallback, intentPayload?.paymentId, normalizedPaymentStatus])

  // ── Poll intent when no payment exists yet (catches merchant cancel before
  //    the customer selects a network) ────────────────────────────────────────

  useEffect(() => {
    if (!intentId) return
    if (intentPayload?.paymentId) return
    if (isTerminalPaymentStatus(normalizedPaymentStatus)) return

    const interval = setInterval(() => {
      void loadIntentCallback()
    }, 5000)

    return () => clearInterval(interval)
  }, [intentId, loadIntentCallback, intentPayload?.paymentId, normalizedPaymentStatus])

  // ── Wallet-browser mode: Phantom provider flow ────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    const paymentId = params.get("pinetree_payment_id")
    const mode = params.get("mode")
    const wallet = params.get("wallet")

    const guardKey = paymentId ? `pinetree_wallet_triggered_${paymentId}` : "pinetree_wallet_triggered"
    const hasTriggered = sessionStorage.getItem(guardKey)

    if (
      mode === "wallet-browser" &&
      wallet === "phantom" &&
      paymentId &&
      !hasTriggered
    ) {
      sessionStorage.setItem(guardKey, "true")

      const run = async () => {
        try {
          const provider = await waitForInjectedPhantomProvider()

          if (!provider) {
            console.error("[Phantom] provider not found")
            const intentIdParam = params.get("intent")
            window.location.href = intentIdParam
              ? `/pay?intent=${encodeURIComponent(intentIdParam)}&phantom_error=not_detected`
              : `/pay?pinetree_payment_id=${encodeURIComponent(paymentId)}&phantom_error=not_detected`
            return
          }

          const connectResult = await provider.connect()

          const walletPublicKey = getSolanaProviderPublicKey(provider, connectResult)
          if (!walletPublicKey) {
            throw new Error("Unable to read Phantom wallet public key")
          }

          const res = await fetch(`/api/solana-pay/transaction?paymentId=${encodeURIComponent(paymentId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: walletPublicKey }),
          })

          const data = (await res.json()) as SolanaPayTransactionResponse

          if (!data?.transaction) {
            console.error("[Phantom] no transaction returned", data?.error)
            return
          }

          const { Transaction } = await import("@solana/web3.js")

          const tx = Transaction.from(Buffer.from(data.transaction, "base64"))

          const result = await provider.signAndSendTransaction(tx)
          const signature = getSolanaTransactionSignature(result)
          if (!signature) {
            throw new Error("Phantom did not return a transaction signature")
          }

          console.log("PineTree TX SIGNATURE:", signature)

          await fetch(`/api/payments/${encodeURIComponent(paymentId)}/detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash: signature }),
          }).catch(() => null)

          const intentId = params.get("intent")
          window.location.href = intentId
            ? `/pay?intent=${encodeURIComponent(intentId)}`
            : `/pay?pinetree_payment_id=${encodeURIComponent(paymentId)}&status=processing`
        } catch (err) {
          console.error("[Phantom] flow error:", err)

          const isRejected =
            (err as { message?: string; code?: number })?.message?.toLowerCase().includes("rejected") ||
            (err as { code?: number })?.code === 4001

          try {
            await fetch(`/api/payments/${encodeURIComponent(paymentId)}/fail`, {
              method: "POST",
              headers: checkoutTokenRef.current
                ? { Authorization: `Bearer ${checkoutTokenRef.current}` }
                : {},
            })
          } catch {}

          const intentIdParam = params.get("intent")
          if (intentIdParam) {
            window.location.href = isRejected
              ? `/pay?intent=${encodeURIComponent(intentIdParam)}&status=cancelled`
              : `/pay?intent=${encodeURIComponent(intentIdParam)}&status=failed`
          }
        }
      }

      void run()
    }
  }, [])

  // ── Solflare Universal Link v1 callback handler ───────────────────────────
  //
  // Handles two redirect actions appended to the URL by Solflare:
  //
  //  connect_callback — user approved connect; decrypt response, store session,
  //    build transaction, navigate to signAndSendTransaction deeplink.
  //
  //  sign_callback — user approved/denied signing; on success decrypt signature
  //    and call /detect; on rejection call /fail. Clear session and redirect.

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const action = params.get("solflare_action")
    if (action !== "connect_callback" && action !== "sign_callback") return

    // Log entry BEFORE the guard so every callback visit is visible in Vercel logs
    void logSolflare("callback-entry", {
      action,
      hasIntent: !!params.get("intent"),
      hasNonce: !!params.get("nonce"),
      hasData: !!params.get("data"),
      hasSolflarePubKey: !!params.get("solflare_encryption_public_key"),
      hasErrorCode: !!params.get("errorCode"),
      hasErrorMessage: !!params.get("errorMessage"),
    })

    // Per-fingerprint guard — unique per Solflare response, key is never removed
    // so duplicate invocations (StrictMode) are blocked without blocking retries
    // (each new Solflare response has a different nonce).
    const callbackFingerprint =
      params.get("nonce") ||
      params.get("data")?.slice(0, 24) ||
      `${action}:${Date.now()}`
    const guardKey = `pinetree_sf_cb_${action}_${callbackFingerprint}`
    if (sessionStorage.getItem(guardKey)) {
      void logSolflare("callback-skipped-duplicate", { guardKey })
      return
    }
    sessionStorage.setItem(guardKey, "1")

    const iid = params.get("intent") ?? ""

    const fail = async (paymentId: string) => {
      await fetch(`/api/payments/${encodeURIComponent(paymentId)}/fail`, {
        method: "POST",
        headers: checkoutTokenRef.current
          ? { Authorization: `Bearer ${checkoutTokenRef.current}` }
          : {},
      }).catch(() => null)
    }

    const redirectTo = (path: string) => { window.location.href = path }

    const run = async () => {
      // ── connect_callback ─────────────────────────────────────────────────
      if (action === "connect_callback") {
        await logSolflare("connect-callback-start", {})

        const flowId = params.get("solflare_flow") ?? ""

        if (flowId) {
          const sfPublicKey = params.get("solflare_encryption_public_key") ?? ""
          const nonce = params.get("nonce") ?? ""
          const data = params.get("data") ?? ""

          const callbackRes = await fetch("/api/solflare/connect-callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              flowId,
              solflareEncryptionPublicKey: sfPublicKey,
              nonce,
              data,
            }),
          })
          const callbackData = (await callbackRes.json()) as {
            ok?: boolean
            paymentId?: string
            walletPublicKey?: string
            error?: string
          }

          await logSolflare("connect-decrypt-result", {
            success: !!callbackData.ok,
            hasPublicKey: !!callbackData.walletPublicKey,
            hasSession: callbackData.ok ? true : false,
          })

          if (!callbackRes.ok || !callbackData.ok || !callbackData.paymentId || !callbackData.walletPublicKey) {
            console.error("[Solflare:connect] server decrypt failed — redirecting to retry")
            redirectTo(
              iid
                ? `/pay?intent=${encodeURIComponent(iid)}&solflare_error=connect_decrypt_failed`
                : "/pay",
            )
            return
          }

          await logSolflare("build-tx-request", {
            paymentId: callbackData.paymentId,
            walletPublicKeyPrefix: callbackData.walletPublicKey.slice(0, 8),
          })
          const res = await fetch(`/api/solana-pay/transaction?paymentId=${encodeURIComponent(callbackData.paymentId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: callbackData.walletPublicKey }),
          })
          const txData = (await res.json()) as SolanaPayTransactionResponse
          await logSolflare("build-tx-response", {
            ok: res.ok,
            status: res.status,
            hasTransaction: !!txData.transaction,
            error: txData.error || null,
          })

          if (!res.ok || !txData.transaction) {
            console.error("[Solflare:connect] build tx failed — not calling /fail")
            redirectTo(iid ? `/pay?intent=${encodeURIComponent(iid)}&solflare_error=build_failed` : "/pay")
            return
          }

          const base = `${window.location.origin}/pay?intent=${encodeURIComponent(iid)}`
          const signRedirect = `${base}&solflare_action=sign_callback&solflare_payment_id=${encodeURIComponent(callbackData.paymentId)}&solflare_flow=${encodeURIComponent(flowId)}`
          const signRes = await fetch("/api/solflare/build-sign-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              flowId,
              transactionBase64: txData.transaction,
              redirectLink: signRedirect,
            }),
          })
          const signData = (await signRes.json()) as { signUrl?: string; error?: string }

          if (!signRes.ok || !signData.signUrl) {
            console.error("[Solflare:connect] build sign URL failed", signData.error)
            redirectTo(iid ? `/pay?intent=${encodeURIComponent(iid)}&solflare_error=build_failed` : "/pay")
            return
          }

          await logSolflare("sign-url-built", {
            startsWithCorrectEndpoint: signData.signUrl.startsWith("https://solflare.com/ul/v1/signAndSendTransaction"),
            length: signData.signUrl.length,
          })

          await logSolflare("sign-url-opening", {})
          window.location.href = signData.signUrl
          return
        }

        const session = decryptConnectResponse(params)
        await logSolflare("connect-decrypt-result", {
          success: !!session,
          hasPublicKey: !!session?.publicKey,
          hasSession: !!session?.session,
          hasSfPublicKey: !!session?.sfPublicKey,
        })

        if (!session) {
          console.error("[Solflare:connect] decrypt failed — clearing session, redirecting to retry")
          clearSolflareSession()
          redirectTo(iid ? `/pay?intent=${encodeURIComponent(iid)}&solflare_error=connect_failed` : "/pay")
          return
        }

        storeSession(session)

        const paymentId = consumePendingPaymentId()
        await logSolflare("pending-payment", {
          pendingPaymentId: paymentId || "MISSING",
        })

        if (!paymentId) {
          console.error("[Solflare:connect] no pending paymentId — clearing session, redirecting to retry")
          clearSolflareSession()
          redirectTo(iid ? `/pay?intent=${encodeURIComponent(iid)}&solflare_error=connect_failed` : "/pay")
          return
        }

        await logSolflare("build-tx-request", {
          paymentId,
          walletPublicKeyPrefix: session.publicKey.slice(0, 8),
        })
        const res = await fetch(`/api/solana-pay/transaction?paymentId=${encodeURIComponent(paymentId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: session.publicKey }),
        })
        const txData = (await res.json()) as SolanaPayTransactionResponse
        await logSolflare("build-tx-response", {
          ok: res.ok,
          status: res.status,
          hasTransaction: !!txData.transaction,
          error: txData.error || null,
        })

        if (!res.ok || !txData.transaction) {
          console.error("[Solflare:connect] build tx failed — not calling /fail, clearing session")
          clearSolflareSession()
          redirectTo(iid ? `/pay?intent=${encodeURIComponent(iid)}&solflare_error=build_failed` : "/pay")
          return
        }

        const base = `${window.location.origin}/pay?intent=${encodeURIComponent(iid)}`
        const signRedirect = `${base}&solflare_action=sign_callback&solflare_payment_id=${encodeURIComponent(paymentId)}`
        const signUrl = buildSignAndSendUrl(txData.transaction, session, signRedirect)
        await logSolflare("sign-url-built", {
          startsWithCorrectEndpoint: signUrl.startsWith("https://solflare.com/ul/v1/signAndSendTransaction"),
          length: signUrl.length,
        })

        await logSolflare("sign-url-opening", {})
        window.location.href = signUrl
        return
      }

      // ── sign_callback ─────────────────────────────────────────────────────
      if (action === "sign_callback") {
        const paymentId = params.get("solflare_payment_id") ?? ""
        const flowId = params.get("solflare_flow") ?? ""
        const errorCode = params.get("errorCode")
        const errorMessage = params.get("errorMessage")
        const signNonce = params.get("nonce")
        const signData = params.get("data")
        const rawSignature = params.get("signature")

        await logSolflare("sign-callback-start", {
          paymentId: paymentId || "MISSING",
          errorCode: errorCode ?? null,
          errorMessage: errorMessage ?? null,
          nonce: signNonce ? "present" : "MISSING",
          data: signData ? "present" : "MISSING",
          signature: rawSignature ? "present" : "MISSING",
        })

        if (errorCode || errorMessage) {
          console.log("[Solflare:sign] user rejected or error:", errorCode, errorMessage)
          if (paymentId) await fail(paymentId)
          const isRejected =
            errorCode === "4001" ||
            String(errorMessage ?? "").toLowerCase().includes("reject") ||
            String(errorMessage ?? "").toLowerCase().includes("cancel")
          clearSolflareSession()
          redirectTo(
            iid
              ? `/pay?intent=${encodeURIComponent(iid)}&status=${isRejected ? "cancelled" : "failed"}`
              : "/pay",
          )
          return
        }

        if (flowId) {
          const callbackRes = await fetch("/api/solflare/sign-callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              flowId,
              nonce: signNonce,
              data: signData,
              signature: rawSignature,
            }),
          })
          const callbackData = (await callbackRes.json()) as {
            ok?: boolean
            paymentId?: string
            intentId?: string | null
            signature?: string
            error?: string
          }

          await logSolflare("sign-decrypt-result", {
            success: !!callbackData.signature,
            signaturePrefix: callbackData.signature ? callbackData.signature.slice(0, 8) : null,
          })

          const resolvedPaymentId = callbackData.paymentId || paymentId
          if (!callbackRes.ok || !callbackData.ok || !callbackData.signature || !resolvedPaymentId) {
            console.error("[Solflare:sign] failed to decrypt signature")
            if (resolvedPaymentId) await fail(resolvedPaymentId)
            redirectTo(iid ? `/pay?intent=${encodeURIComponent(iid)}&status=failed` : "/pay")
            return
          }

          await logSolflare("detect-calling", { paymentId: resolvedPaymentId, hasSignature: true })
          await fetch(`/api/payments/${encodeURIComponent(resolvedPaymentId)}/detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash: callbackData.signature }),
          }).catch(() => null)

          redirectTo(
            iid
              ? `/pay?intent=${encodeURIComponent(iid)}&status=processing`
              : `/pay?pinetree_payment_id=${encodeURIComponent(resolvedPaymentId)}&status=processing`,
          )
          return
        }

        const session = getStoredSession()
        await logSolflare("sign-session-check", {
          hasSession: !!session,
          hasPaymentId: !!paymentId,
        })

        if (!session || !paymentId) {
          console.error("[Solflare:sign] missing session or paymentId")
          if (paymentId) await fail(paymentId)
          clearSolflareSession()
          redirectTo(iid ? `/pay?intent=${encodeURIComponent(iid)}&status=failed` : "/pay")
          return
        }

        const signature = decryptSignResponse(params, session.sfPublicKey)
        await logSolflare("sign-decrypt-result", {
          success: !!signature,
          signaturePrefix: signature ? signature.slice(0, 8) : null,
        })

        if (!signature) {
          console.error("[Solflare:sign] failed to decrypt signature")
          await fail(paymentId)
          clearSolflareSession()
          redirectTo(iid ? `/pay?intent=${encodeURIComponent(iid)}&status=failed` : "/pay")
          return
        }

        await logSolflare("detect-calling", { paymentId, hasSignature: true })
        await fetch(`/api/payments/${encodeURIComponent(paymentId)}/detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: signature }),
        }).catch(() => null)

        clearSolflareSession()
        redirectTo(
          iid
            ? `/pay?intent=${encodeURIComponent(iid)}&status=processing`
            : `/pay?pinetree_payment_id=${encodeURIComponent(paymentId)}&status=processing`,
        )
      }
    }

    void run()
  }, [])

  // ── Realtime subscription: instant status updates from DB ─────────────────

  useEffect(() => {
    const paymentId = intentPayload?.paymentId
    if (!paymentId) return

    const isTerminal = isTerminalPaymentStatus(normalizedPaymentStatus)
    if (isTerminal) return

    const channel = supabase
      .channel("payments")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `id=eq.${paymentId}`
        },
        (event) => {
          const newStatus = String(
            (event.new as Record<string, unknown>)?.status ?? ""
          ).toUpperCase()
          if (!newStatus) return
          if (newStatus === "INCOMPLETE" || newStatus === "FAILED") {
            // Re-load intent before accepting a terminal status — a network switch may
            // have already linked a new PENDING payment to this intent.
            void loadIntentCallback()
          } else {
            setPaymentStatus(newStatus)
          }
        }
      )
      .subscribe()

    return () => {
      void channel.unsubscribe()
    }
  }, [intentPayload?.paymentId, normalizedPaymentStatus, loadIntentCallback])

  // ── Clipboard helpers ──────────────────────────────────────────────────────

  async function copyWalletUrl() {
    if (!walletUrl) return
    try {
      await navigator.clipboard.writeText(walletUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 1500)
    } catch { /* ignore */ }
  }

  async function copyAddress() {
    if (!recipientAddress) return
    try {
      await navigator.clipboard.writeText(recipientAddress)
      setCopiedAddress(true)
      setTimeout(() => setCopiedAddress(false), 1500)
    } catch { /* ignore */ }
  }

  async function copyAmount(amount?: number) {
    const val = Number(amount || 0)
    if (!Number.isFinite(val) || val <= 0) return
    try {
      await navigator.clipboard.writeText(String(val))
      setCopiedAmount(true)
      setTimeout(() => setCopiedAmount(false), 1500)
    } catch { /* ignore */ }
  }

  // ── Loading / error screens ────────────────────────────────────────────────

  // POS-terminal-controlled Base payment: status-only follow-along page.
  // WalletConnect runs on the POS terminal, not here.
  if (isPosStatusMode && posStatusPaymentId) {
    const normalizedPosStatus = posPaymentStatus.toUpperCase()
    const isPosTerminal = TERMINAL_PAYMENT_STATUSES.has(normalizedPosStatus)

    const statusLabel = (() => {
      if (!posStatusLoaded) return "Loading payment status…"
      if (!normalizedPosStatus || normalizedPosStatus === "CREATED" || normalizedPosStatus === "PENDING") {
        return posStatusAsset === "USDC"
          ? "Awaiting USDC authorization on payment terminal"
          : "Awaiting payment approval on payment terminal"
      }
      if (normalizedPosStatus === "PROCESSING") {
        return posStatusAsset === "USDC"
          ? "USDC payment submitted — confirming on Base"
          : "ETH payment submitted — confirming on Base"
      }
      if (normalizedPosStatus === "CONFIRMED") return "Payment confirmed"
      if (normalizedPosStatus === "FAILED") return "Payment failed"
      if (normalizedPosStatus === "INCOMPLETE") return "Payment incomplete"
      if (normalizedPosStatus === "EXPIRED") return "Payment expired"
      if (normalizedPosStatus === "CANCELED") return "Payment canceled"
      return "Processing payment…"
    })()

    return (
      <PageContainer>
        <Card className="max-w-md w-full space-y-5 text-center">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#0052FF]">
              PineTree Payments
            </p>
            <h1 className="text-xl font-bold text-gray-900">
              {posStatusAsset === "ETH" || posStatusAsset === "USDC"
                ? `Base ${posStatusAsset} Payment`
                : "Base Payment"}
            </h1>
          </div>

          {!posStatusLoaded ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-10 w-10 rounded-full border-2 border-[#0052FF] border-t-transparent animate-spin" />
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          ) : isPosTerminal ? (
            <div className="py-2">
              <PaymentStatusVisual status={normalizedPosStatus} variant="card" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="h-10 w-10 rounded-full border-2 border-[#0052FF] border-t-transparent animate-spin" />
              <p className="text-sm font-medium text-gray-700">{statusLabel}</p>
              <p className="text-xs text-gray-400">
                Approve the transaction in your wallet app when prompted by the payment terminal.
              </p>
            </div>
          )}

          {posStatusLoaded && !isPosTerminal && (
            <p className="text-xs text-gray-400">Updating automatically…</p>
          )}
        </Card>
      </PageContainer>
    )
  }

  if (isSolflareCallbackMode) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#0052FF] border-t-transparent mx-auto" />
          <h1 className="text-lg font-bold text-gray-900">Processing Solflare payment...</h1>
          <p className="text-sm text-gray-500">Please wait while we confirm your transaction.</p>
        </Card>
      </PageContainer>
    )
  }

  if (intentId && !intentPayload) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-4">
          {intentLoadError ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
              <h1 className="text-xl font-bold text-gray-900">Unable to Load Payment</h1>
              <p className="text-sm text-gray-500">{intentLoadError}</p>
              <Button onClick={() => { setIntentLoadError(""); void loadIntent() }} className="mt-2">
                Retry
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#0052FF] border-t-transparent mx-auto" />
              <h1 className="text-lg font-bold text-gray-900">Loading payment…</h1>
            </>
          )}
        </Card>
      </PageContainer>
    )
  }

  if (isWalletBrowserMode) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#0052FF] border-t-transparent mx-auto" />
          <h1 className="text-lg font-bold text-gray-900">Opening transaction in Phantom...</h1>
          <p className="text-sm text-gray-500">Please approve the transaction in your Phantom wallet.</p>
        </Card>
      </PageContainer>
    )
  }

  if (!rawData && !intentPayload) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
          <h1 className="text-xl font-bold text-gray-900">Invalid Payment Link</h1>
          <p className="text-sm text-gray-500">This payment link payload is missing or malformed.</p>
        </Card>
      </PageContainer>
    )
  }

  // ── Intent mode ────────────────────────────────────────────────────────────

  const displayAmount = isIntentMode
    ? Number(intentPayload?.amount || 0) + Number(intentPayload?.pinetreeFee || 0)
    : Number(payload?.usdTotalAmount ?? payload?.totalAmount ?? 0)

  if (isIntentMode && !selectedAssetId && !intentPayload?.availableNetworks?.length) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
          <h1 className="text-xl font-bold text-gray-900">No Payment Methods Available</h1>
          <p className="text-sm text-gray-500">This merchant has no payment methods enabled.</p>
        </Card>
      </PageContainer>
    )
  }

  if (isIntentMode && terminalPaymentStatus) {
    const isMerchantCanceled =
      terminalPaymentStatus === "INCOMPLETE" || terminalPaymentStatus === "CANCELED"
    const isConfirmed = terminalPaymentStatus === "CONFIRMED"
    const returnUrl = isConfirmed ? successUrl : cancelUrl
    const returnLabel = isConfirmed ? "Return to merchant" : "Return to store"
    return (
      <PageContainer>
        <div className="w-full max-w-md space-y-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
          <PaymentStatusVisual
            status={terminalPaymentStatus}
            variant="card"
            labelOverride={isMerchantCanceled ? "Sale canceled" : undefined}
            messageOverride={isMerchantCanceled ? "This payment was canceled by the merchant." : undefined}
          />
          {returnUrl && (
            <a
              href={returnUrl}
              className="inline-block rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:border-[#0052FF]/30 hover:text-[#0052FF]"
            >
              {returnLabel}
            </a>
          )}
        </div>
      </PageContainer>
    )
  }

  if (
    isIntentMode &&
    intentPayload?.selectedNetwork !== "solana" &&
    (normalizedPaymentStatus === "PROCESSING" || statusOverride === "processing")
  ) {
    return (
      <PageContainer>
        <div className="w-full max-w-md space-y-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
          <PaymentStatusVisual status="PROCESSING" variant="card" />
        </div>
      </PageContainer>
    )
  }

  if (isIntentMode) {
    const amountSummary = (
      <div className="rounded-2xl border border-[#0052FF]/10 bg-gradient-to-br from-white via-[#f8fbff] to-[#edf5ff] p-4 text-sm text-gray-800 shadow-sm shadow-[#0052FF]/5">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Subtotal</span>
          <span className="font-semibold">{formatUsd(Number(intentPayload?.amount || 0))}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-gray-600">PineTree Service Fee</span>
          <span className="font-semibold">{formatUsd(Number(intentPayload?.pinetreeFee || 0))}</span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[#0052FF]/10 pt-3">
          <span className="font-semibold text-gray-900">Total</span>
          <span className="font-bold text-lg text-gray-900">{formatUsd(displayAmount)}</span>
        </div>
      </div>
    )

    return (
      <PageContainer>
        <Card className="max-w-md w-full space-y-5">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#0052FF]">PineTree Checkout</p>
            {!(baseExecutionActive || solanaExecutionActive) && (
              <h1 className="text-2xl font-bold text-gray-900">Choose Payment Asset</h1>
            )}
          </div>

          {amountSummary}

          <div className="space-y-3" ref={intentCardsRef}>
            {!(baseExecutionActive || solanaExecutionActive) && (
              <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">Select an asset to continue:</p>
            )}

            <div className="space-y-3">
              {getCheckoutAssetOptions(intentPayload?.availableNetworks || []).map((asset) => {
                const isActive = selectedAssetId === asset.id

                // While wallet execution is running, hide all non-active asset cards
                if ((baseExecutionActive || solanaExecutionActive) && !isActive) return null

                return (
                  <div
                    key={asset.id}
                    className={
                      (baseExecutionActive || solanaExecutionActive) && isActive && (asset.network === "base" || asset.network === "solana")
                        ? "overflow-visible rounded-3xl bg-transparent"
                        : isActive
                          ? "overflow-hidden rounded-3xl border border-[#0052FF]/35 bg-gradient-to-br from-white via-[#f7fbff] to-[#eaf3ff] shadow-[0_18px_44px_rgba(0,82,255,0.14)] ring-1 ring-[#0052FF]/10"
                          : "overflow-hidden rounded-3xl border border-[#0052FF]/15 bg-gradient-to-br from-white via-[#f8fbff] to-[#eef6ff] shadow-[0_12px_30px_rgba(15,23,42,0.07)] ring-1 ring-white/80 transition-all hover:-translate-y-0.5 hover:border-[#0052FF]/30 hover:shadow-[0_18px_40px_rgba(0,82,255,0.12)]"
                    }
                  >
                    {/* Asset selector button — hidden once execution starts */}
                    {!(baseExecutionActive || solanaExecutionActive) && (
                      <button
                        onClick={() => {
                          if (asset.disabled) return
                          selectAsset(asset.id)
                        }}
                        disabled={asset.disabled}
                        className={`group flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-all ${
                          asset.disabled
                            ? "cursor-not-allowed bg-gray-100 text-gray-400"
                            : isActive
                              ? "bg-[#0052FF]/5"
                              : "bg-white/0 hover:bg-white/45"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold text-gray-950">Pay with {asset.label}</span>
                          <span className={`mt-1 block text-xs ${
                            asset.disabled ? "text-gray-400" : isActive ? "text-[#0052FF]" : "text-gray-500"
                          }`}>
                            {asset.disabled
                              ? asset.disabledCopy
                              : isActive
                                ? "Choose a wallet below"
                                : "Tap to reveal payment options"}
                          </span>
                        </span>
                        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl border transition-all ${
                          asset.disabled
                            ? "border-gray-200 bg-gray-50 text-gray-300"
                            : isActive
                              ? "border-[#0052FF]/25 bg-[#0052FF] text-white shadow-sm shadow-[#0052FF]/25"
                              : "border-[#0052FF]/15 bg-white/75 text-[#0052FF] shadow-sm group-hover:border-[#0052FF]/30 group-hover:bg-[#0052FF]/8"
                        }`}>
                          <span className="text-lg leading-none">{isActive ? "-" : "+"}</span>
                        </span>
                      </button>
                    )}

                    {/* Payment UI — always mounted when active so state is never lost */}
                    {isActive ? (
                      <div className={`${baseExecutionActive || solanaExecutionActive ? "p-0 bg-transparent" : "border-t border-[#0052FF]/10 bg-white/70 px-4 py-4 shadow-inner shadow-[#0052FF]/5"} space-y-4`}>

                        {/* ── Shift4: hosted checkout redirect ──────────── */}
                        {asset.network === "shift4" ? (
                          <div className="space-y-3">
                            <p className="text-sm text-gray-700">
                              You will be redirected to a secure checkout page to complete your payment.
                            </p>
                            {shift4Error ? (
                              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                                {shift4Error}
                              </div>
                            ) : null}
                            <Button
                              fullWidth
                              disabled={shift4Loading}
                              onClick={() => void handleShift4Pay()}
                            >
                              {shift4Loading ? (
                                <>
                                  <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
                                  Preparing checkout…
                                </>
                              ) : "Continue to Checkout"}
                            </Button>
                          </div>
                        ) : null}

                        {/* ── Base: in-page wallet execution ────────────── */}
                        {asset.network === "base" ? (
                          <BaseWalletPayment
                            intentId={intentId!}
                            selectedAsset={asset.symbol === "USDC" ? "USDC" : "ETH"}
                            usdAmount={displayAmount}
                            paymentStatus={normalizedPaymentStatus}
                            checkoutToken={checkoutToken}
                            onExecutionStarted={() => setBaseExecutionActive(true)}
                            onCancel={handleBaseCancelPayment}
                            onPaymentCreated={() => {
                              void loadIntentCallback()
                            }}
                            onSuccess={async (txHash, paymentId) => {
                              console.log("[PineTreeBaseTrace] PayClient onSuccess", {
                                step: "on-success",
                                paymentId,
                                txHashPrefix: txHash.slice(0, 10)
                              })
                              console.log("[PineTreeBaseTrace] PayClient detect POST start", {
                                step: "detect-post-start",
                                paymentId,
                                txHashPrefix: txHash.slice(0, 10)
                              })
                              const detectRes = await fetch(
                                `/api/payments/${encodeURIComponent(paymentId)}/detect`,
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ txHash }),
                                }
                              )
                                .catch(() => null)
                              console.log("[PineTreeBaseTrace] PayClient detect POST done", {
                                step: "detect-post-done",
                                paymentId,
                                status: detectRes?.status ?? "error"
                              })
                              await loadIntentCallback()
                            }}
                          />
                        ) : null}

                        {/* ── Solana: canonical engine payment session + wallet links ── */}
                        {asset.network === "solana" ? (
                          <SolanaWalletPayment
                            intentId={intentId!}
                            selectedAsset={asset.symbol === "USDC" ? "USDC" : "SOL"}
                            usdAmount={displayAmount}
                            paymentStatus={normalizedPaymentStatus}
                            checkoutToken={checkoutToken}
                            initialError={getPhantomRetryMessage(phantomError) || getSolflareRetryMessage(solflareError)}
                            onExecutionStarted={() => setSolanaExecutionActive(true)}
                            onCancel={handleSolanaCancelPayment}
                            onPaymentCreated={() => {
                              void loadIntentCallback()
                            }}
                          />
                        ) : null}

                        {/* ── Other networks: unavailable in hosted checkout ─────── */}
                        {asset.network === "bitcoin_lightning" ? (
                          <LightningPayment
                            intentId={intentId!}
                            usdAmount={displayAmount}
                            paymentStatus={normalizedPaymentStatus}
                            checkoutToken={checkoutToken}
                            onPaymentCreated={() => {
                              void loadIntentCallback()
                            }}
                            onCancel={handleLightningCancelPayment}
                          />
                        ) : null}

                        {asset.network !== "shift4" &&
                          asset.network !== "base" &&
                          asset.network !== "solana" &&
                          asset.network !== "bitcoin_lightning" ? (
                          <div className="text-xs text-gray-500 text-center">
                            This payment method is not available in the hosted checkout.
                          </div>
                        ) : null}

                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {!(baseExecutionActive || solanaExecutionActive) && (
              <Button variant="danger" fullWidth onClick={() => window.close()}>
                Cancel
              </Button>
            )}
          </div>
        </Card>
      </PageContainer>
    )
  }

  // ── Direct-payload mode (non-intent) ───────────────────────────────────────

  const network = String(activePayload?.network || selectedNetwork || "unknown").toUpperCase()
  const usdTotalAmount = Number(activePayload?.usdTotalAmount ?? activePayload?.totalAmount ?? 0)
  const nativeAmount = Number(activePayload?.nativeAmount ?? 0)
  const nativeSymbol = String(activePayload?.nativeSymbol || "").toUpperCase()

  return (
    <PageContainer>
      <Card className="max-w-md w-full space-y-5">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">PineTree</p>
          <h1 className="text-2xl font-bold text-gray-900">Complete Payment</h1>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Network</span>
            <span className="font-semibold text-gray-900">{network}</span>
          </div>
          {nativeSymbol && Number.isFinite(nativeAmount) && nativeAmount > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Pay Amount</span>
              <span className="font-semibold text-gray-900">{nativeAmount} {nativeSymbol}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-gray-200 pt-2">
            <span className="font-semibold text-gray-900">Total</span>
            <span className="font-bold text-lg text-gray-900">{formatUsd(usdTotalAmount)}</span>
          </div>
          {nativeSymbol && Number.isFinite(nativeAmount) && nativeAmount > 0 ? (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Send the exact crypto amount shown. Wallet USD conversion can underpay and prevent confirmation.
            </div>
          ) : null}
        </div>

        {isBaseContractPayment(activePayload) ? (
          <BaseWalletPayment
            paymentUrl={String(activePayload?.paymentUrl || "")}
            nativeAmount={nativeAmount}
            usdAmount={usdTotalAmount}
            selectedAsset={nativeSymbol === "USDC" ? "USDC" : "ETH"}
          />
        ) : isSolanaPayment(activePayload) ? (
          <SolanaWalletPayment
            paymentUrl={String(activePayload?.paymentUrl || "")}
            nativeAmount={nativeAmount}
            usdAmount={usdTotalAmount}
            selectedAsset={nativeSymbol === "USDC" ? "USDC" : "SOL"}
            paymentStatus={normalizedPaymentStatus}
            walletOptions={walletOptions}
          />
        ) : null}

        {recipientAddress && !isBaseContractPayment(activePayload) && !isSolanaPayment(activePayload) ? (
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-gray-500">Payment Address</label>
            <div className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 break-all font-mono">
              {recipientAddress}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={copyAddress}>
                {copiedAddress ? "Address Copied" : "Copy Address"}
              </Button>
              <Button variant="secondary" onClick={() => copyAmount(nativeAmount)}>
                {copiedAmount ? "Amount Copied" : "Copy Amount"}
              </Button>
            </div>
          </div>
        ) : null}

        {!isSolanaPayment(activePayload) && !isBaseContractPayment(activePayload) ? (
        <div className="space-y-3">
          <label className="text-xs uppercase tracking-widest text-gray-500">Select your wallet:</label>
          <select
            value={selectedWalletId}
            onChange={(e) => setSelectedWalletId(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-gray-900"
          >
            <option value="">Choose a wallet…</option>
            {walletOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            <option value="manual">Manual / Other Wallet</option>
          </select>

          {selectedWalletId && selectedWalletId !== "manual" ? (
            <Button
              fullWidth
              disabled={!selectedWallet}
              onClick={() => {
                if (!selectedWallet?.href) return
                window.location.href = selectedWallet.href
              }}
            >
              Open {selectedWallet?.label}
            </Button>
          ) : null}

          {selectedWalletId === "manual" ? (
            <Button fullWidth onClick={copyWalletUrl}>
              {copiedLink ? "Copied ✓" : "Copy Payment Address"}
            </Button>
          ) : null}
        </div>
        ) : null}

        {walletUrl && !isSolanaPayment(activePayload) && !isBaseContractPayment(activePayload) ? (
          <Button variant="secondary" fullWidth onClick={copyWalletUrl}>
            {copiedLink ? "Copied" : "Copy Wallet Address"}
          </Button>
        ) : null}

        {primaryOpenUrl && !isSolanaPayment(activePayload) && !isBaseContractPayment(activePayload) ? (
          <Button fullWidth onClick={() => { window.location.href = primaryOpenUrl }}>
            Open in Wallet App
          </Button>
        ) : null}

        <Button
          variant="danger"
          fullWidth
          onClick={() => {
            setSelectedNetwork(null)
            setSelectedWalletId("")
            setPaymentPayload(null)
          }}
        >
          Cancel
        </Button>
      </Card>
    </PageContainer>
  )
}
