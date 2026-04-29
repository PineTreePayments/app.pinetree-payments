"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createBrowserClient } from "@supabase/ssr"
import { ALLOWED_ASSETS, getAvailableAssetsFromValues } from "@/engine/providerMappings"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import PageContainer from "@/components/ui/PageContainer"
import StatusBadge from "@/components/ui/StatusBadge"
import BaseWalletPayment from "@/components/payment/BaseWalletPayment"
import SolanaWalletPayment from "@/components/payment/SolanaWalletPayment"

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
  paymentId?: string | null
  paymentStatus?: string | null
  checkoutUrl?: string
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

function getCheckoutAssetOptions(networks: string[]): AssetOption[] {
  const availableAssets = getAvailableAssetsFromValues(networks)

  return availableAssets.map((assetId) => {
    const asset = ALLOWED_ASSETS[assetId]
    const isUnsupportedSolanaUsdc = assetId === "sol-usdc"

    return {
      id: assetId,
      label: asset.label,
      network: asset.network,
      symbol: asset.symbol,
      disabled: isUnsupportedSolanaUsdc,
      disabledCopy: isUnsupportedSolanaUsdc ? "USDC on Solana coming soon" : undefined
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
  const isWalletBrowserMode =
    walletBrowserMode === "wallet-browser" &&
    walletBrowserWallet === "phantom" &&
    Boolean(walletBrowserPaymentId)

  // ── Shared clipboard state ─────────────────────────────────────────────────
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [copiedAmount, setCopiedAmount] = useState(false)

  // ── Intent mode state ──────────────────────────────────────────────────────
  const [selectedAssetId, setSelectedAssetId] = useState<string>("")
  const [paymentStatus, setPaymentStatus] = useState<string>("")
  const [intentPayload, setIntentPayload] = useState<IntentPayload | null>(null)
  const [intentLoadError, setIntentLoadError] = useState<string>("")

  // ── Shift4 redirect state (inline — no dedicated component needed) ─────────
  const [shift4Loading, setShift4Loading] = useState(false)
  const [shift4Error, setShift4Error] = useState("")

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
      setPaymentStatus(String(intent.paymentStatus || ""))
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
    setShift4Loading(true)
    setShift4Error("")
    try {
      const res = await fetch(
        `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

  // ── Deselect asset when clicking outside the card list ────────────────────

  useEffect(() => {
    if (!selectedAssetId) return

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
  }, [selectedAssetId])

  // ── Poll intent status once a payment has been created ────────────────────

  useEffect(() => {
    if (!intentId) return
    if (!intentPayload?.paymentId) return
    const isTerminal =
      normalizedPaymentStatus === "CONFIRMED" ||
      normalizedPaymentStatus === "FAILED" ||
      normalizedPaymentStatus === "INCOMPLETE"
    if (isTerminal) return

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

    const hasTriggered = sessionStorage.getItem("pinetree_wallet_triggered")

    if (
      mode === "wallet-browser" &&
      wallet === "phantom" &&
      paymentId &&
      !hasTriggered
    ) {
      sessionStorage.setItem("pinetree_wallet_triggered", "true")

      const run = async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const provider = (window as any).solana

          if (!provider || !provider.isPhantom) {
            console.error("[Phantom] provider not found")
            return
          }

          await provider.connect()

          const walletPublicKey = provider.publicKey.toString() as string

          const res = await fetch("/api/solana/build-wallet-transaction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId, walletPublicKey }),
          })

          const data = (await res.json()) as { transaction?: string; error?: string }

          if (!data?.transaction) {
            console.error("[Phantom] no transaction returned", data?.error)
            return
          }

          const { Transaction } = await import("@solana/web3.js")

          const tx = Transaction.from(Buffer.from(data.transaction, "base64"))

          const result = await provider.signAndSendTransaction(tx) as { signature: string }

          console.log("PineTree TX SIGNATURE:", result.signature)

          await fetch(`/api/payments/${encodeURIComponent(paymentId)}/detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash: result.signature }),
          }).catch(() => null)

          const intentId = params.get("intent")
          window.location.href = intentId
            ? `/pay?intent=${encodeURIComponent(intentId)}`
            : `/pay?pinetree_payment_id=${encodeURIComponent(paymentId)}&status=processing`
        } catch (err) {
          console.error("[Phantom] flow error:", err)
        }
      }

      void run()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime subscription: instant status updates from DB ─────────────────

  useEffect(() => {
    const paymentId = intentPayload?.paymentId
    if (!paymentId) return

    const isTerminal =
      normalizedPaymentStatus === "CONFIRMED" ||
      normalizedPaymentStatus === "FAILED" ||
      normalizedPaymentStatus === "INCOMPLETE"
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

  if (intentId && !intentPayload) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-4">
          {intentLoadError ? (
            <>
              <p className="text-xs uppercase tracking-widest text-gray-500">PineTree Checkout</p>
              <h1 className="text-xl font-bold text-gray-900">Unable to Load Payment</h1>
              <p className="text-sm text-gray-500">{intentLoadError}</p>
              <Button onClick={() => { setIntentLoadError(""); void loadIntent() }} className="mt-2">
                Retry
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-widest text-gray-500">PineTree Checkout</p>
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
          <p className="text-xs uppercase tracking-widest text-gray-500">PineTree Checkout</p>
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
          <p className="text-xs uppercase tracking-widest text-gray-500">PineTree Checkout</p>
          <h1 className="text-xl font-bold text-gray-900">Invalid Payment Link</h1>
          <p className="text-sm text-gray-500">This payment link payload is missing or malformed.</p>
        </Card>
      </PageContainer>
    )
  }

  // ── Intent mode ────────────────────────────────────────────────────────────

  const isIntentMode = Boolean(intentId && intentPayload)
  const displayAmount = isIntentMode
    ? Number(intentPayload?.amount || 0) + Number(intentPayload?.pinetreeFee || 0)
    : Number(payload?.usdTotalAmount ?? payload?.totalAmount ?? 0)

  if (isIntentMode && !selectedAssetId && !intentPayload?.availableNetworks?.length) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-3">
          <p className="text-xs uppercase tracking-widest text-gray-500">PineTree Checkout</p>
          <h1 className="text-xl font-bold text-gray-900">No Payment Methods Available</h1>
          <p className="text-sm text-gray-500">This merchant has no payment methods enabled.</p>
        </Card>
      </PageContainer>
    )
  }

  if (isIntentMode && normalizedPaymentStatus === "CONFIRMED") {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-4" padding={false}>
          <div className="p-8 space-y-4">
            <p className="text-xs uppercase tracking-widest text-gray-500">PineTree Checkout</p>
            <div className="flex justify-center">
              <svg className="w-16 h-16 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Payment Confirmed</h1>
            <p className="text-sm text-gray-500">Your payment was received successfully.</p>
          </div>
        </Card>
      </PageContainer>
    )
  }

  if (isIntentMode && (normalizedPaymentStatus === "FAILED" || normalizedPaymentStatus === "INCOMPLETE")) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-4" padding={false}>
          <div className="p-8 space-y-4">
            <p className="text-xs uppercase tracking-widest text-gray-500">PineTree Checkout</p>
            <div className="flex justify-center">
              <svg className="w-16 h-16 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Payment Failed</h1>
            <p className="text-sm text-gray-500">The payment was not received. Please try again or contact the merchant.</p>
          </div>
        </Card>
      </PageContainer>
    )
  }

  if (isIntentMode) {
    const displayStatus = getPaymentDisplayStatus(
      normalizedPaymentStatus,
      new Date().toISOString()
    )

    return (
      <PageContainer>
        <Card className="max-w-md w-full space-y-5">
          <div>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">PineTree Checkout</p>
            <h1 className="text-2xl font-bold text-gray-900">Choose Payment Asset</h1>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-800">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Subtotal</span>
              <span className="font-semibold">{formatUsd(Number(intentPayload?.amount || 0))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">PineTree Service Fee</span>
              <span className="font-semibold">{formatUsd(Number(intentPayload?.pinetreeFee || 0))}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-2">
              <span className="font-semibold text-gray-900">Total</span>
              <span className="font-bold text-lg text-gray-900">{formatUsd(displayAmount)}</span>
            </div>
          </div>

          <div className="flex justify-center">
            <StatusBadge label={displayStatus.label} classes={`${displayStatus.classes} px-3 py-1.5 text-sm`} />
          </div>

          <div className="space-y-3" ref={intentCardsRef}>
            <p className="text-xs uppercase tracking-widest text-gray-500">Select an asset to continue:</p>

            <div className="space-y-2">
              {getCheckoutAssetOptions(intentPayload?.availableNetworks || []).map((asset) => {
                const isActive = selectedAssetId === asset.id

                return (
                  <div key={asset.id} className="rounded-xl border border-gray-200 overflow-hidden">
                    {/* Asset selector button — pure UI, no API call */}
                    <button
                      onClick={() => {
                        if (asset.disabled) return
                        selectAsset(asset.id)
                      }}
                      disabled={asset.disabled}
                      className={`w-full px-4 py-4 text-left transition ${
                        asset.disabled
                          ? "bg-gray-50 opacity-60 cursor-not-allowed"
                          : isActive
                            ? "bg-blue-50"
                            : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      <span className="font-medium text-gray-900">Pay with {asset.label}</span>
                      <p className="text-xs text-gray-500 mt-1">
                        {asset.disabled
                          ? asset.disabledCopy
                          : isActive
                            ? "Choose a wallet below"
                            : "Tap to reveal payment options"}
                      </p>
                    </button>

                    {/* Payment UI — rendered immediately on selection, no loading gate */}
                    {isActive ? (
                      <div className="px-4 py-4 border-t border-gray-200 bg-white space-y-4">

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
                            usdAmount={displayAmount}
                            onPaymentCreated={() => {
                              void loadIntentCallback()
                            }}
                            onSuccess={(txHash, paymentId) => {
                              void fetch(
                                `/api/payments/${encodeURIComponent(paymentId)}/detect`,
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ txHash }),
                                }
                              )
                                .catch(() => null)
                                .then(() => loadIntentCallback())
                            }}
                          />
                        ) : null}

                        {/* ── Solana: canonical engine payment session + wallet links ── */}
                        {asset.network === "solana" ? (
                          <SolanaWalletPayment
                            intentId={intentId!}
                            selectedAsset={asset.symbol === "USDC" ? "USDC" : "SOL"}
                            usdAmount={displayAmount}
                            onPaymentCreated={() => {
                              void loadIntentCallback()
                            }}
                          />
                        ) : null}

                        {/* ── Other networks: unavailable in hosted checkout ─────── */}
                        {asset.network !== "shift4" &&
                          asset.network !== "base" &&
                          asset.network !== "solana" ? (
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

            <Button variant="danger" fullWidth onClick={() => window.close()}>
              Cancel
            </Button>
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
          />
        ) : isSolanaPayment(activePayload) ? (
          <SolanaWalletPayment
            paymentUrl={String(activePayload?.paymentUrl || "")}
            nativeAmount={nativeAmount}
            usdAmount={usdTotalAmount}
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

        {!isSolanaPayment(activePayload) ? (
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

        {walletUrl && !isSolanaPayment(activePayload) ? (
          <Button variant="secondary" fullWidth onClick={copyWalletUrl}>
            {copiedLink ? "Copied" : "Copy Wallet Address"}
          </Button>
        ) : null}

        {primaryOpenUrl && !isSolanaPayment(activePayload) ? (
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
