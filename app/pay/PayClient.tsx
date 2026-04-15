"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import { ALLOWED_ASSETS, getAvailableAssetsFromValues } from "@/engine/providerMappings"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"

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
  qrCodeUrl?: string
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
  href: string
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

function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number.isFinite(amount) ? amount : 0)
}

export default function PayClient() {
  const searchParams = useSearchParams()
  const rawData = searchParams.get("data")
  const intentId = searchParams.get("intent")
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [copiedAmount, setCopiedAmount] = useState(false)
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<string>("")
  const [loadingAssetId, setLoadingAssetId] = useState<string>("")
  const [selectionError, setSelectionError] = useState<string>("")
  const [paymentStatus, setPaymentStatus] = useState<string>("")
  const [intentPayload, setIntentPayload] = useState<IntentPayload | null>(null)
  const [intentLoadError, setIntentLoadError] = useState<string>("")
  const [paymentPayload, setPaymentPayload] = useState<SplitPayload | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  
  const payload = useMemo(() => parsePayload(rawData), [rawData])
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

  const normalizedPaymentStatus = String(paymentStatus || "").toUpperCase()

  const [selectedWalletId, setSelectedWalletId] = useState("")
  const intentCardsRef = useRef<HTMLDivElement | null>(null)

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
  const paymentQrUrl = String(activePayload?.qrCodeUrl || "")
  const primaryOpenUrl =
    selectedWallet?.href ||
    String(activePayload?.universalUrl || activePayload?.paymentUrl || walletUrl || "")

  useEffect(() => {
    if (!selectedAssetId) {
      setSelectedWalletId("")
      setPaymentPayload(null)
    }
  }, [selectedAssetId])

  useEffect(() => {
    if (!selectedAssetId) return

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null
      if (!target) return

      if (intentCardsRef.current && !intentCardsRef.current.contains(target)) {
        setSelectedAssetId("")
        setLoadingAssetId("")
        setSelectionError("")
        setPaymentPayload(null)
        setSelectedNetwork(null)
      }
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [selectedAssetId])

  async function copyWalletUrl() {
    if (!walletUrl) return
    try {
      await navigator.clipboard.writeText(walletUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  async function copyAddress() {
    if (!recipientAddress) return
    try {
      await navigator.clipboard.writeText(recipientAddress)
      setCopiedAddress(true)
      setTimeout(() => setCopiedAddress(false), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  async function copyAmount(amount?: number) {
    const nativeAmount = Number(amount || 0)
    if (!Number.isFinite(nativeAmount) || nativeAmount <= 0) return

    try {
      await navigator.clipboard.writeText(String(nativeAmount))
      setCopiedAmount(true)
      setTimeout(() => setCopiedAmount(false), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  async function loadIntent() {
    if (!intentId) return
    try {
      const res = await fetch(`/api/payment-intents/${encodeURIComponent(intentId)}`, { cache: "no-store" })
      const payload = (await res.json()) as IntentPayload | { error?: string }
      if (!res.ok || ("error" in payload && payload.error)) {
        const msg = ("error" in payload && payload.error) ? String(payload.error) : "Payment not found"
        setIntentLoadError(msg)
        return
      }
      const intent = payload as IntentPayload
      setIntentPayload(intent)
      setIntentLoadError("")
      setPaymentStatus(String(intent.paymentStatus || ""))
    } catch {
      setIntentLoadError("Unable to load payment. Please try again.")
    }
  }

  const loadIntentCallback = useCallback(loadIntent, [intentId])

  async function selectAsset(assetId: string) {
    if (!intentId) return
    const asset = ALLOWED_ASSETS[assetId as keyof typeof ALLOWED_ASSETS]
    if (!asset) return

    if (selectedAssetId === assetId && !isLoading) {
      setSelectedAssetId("")
      setLoadingAssetId("")
      setSelectionError("")
      setPaymentPayload(null)
      setSelectedNetwork(null)
      return
    }

    setSelectedAssetId(assetId)
    setLoadingAssetId(assetId)
    setSelectionError("")
    setPaymentPayload(null)
    setIsLoading(true)

    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      const controller = new AbortController()
      timeout = setTimeout(() => controller.abort(), 15000)

      const res = await fetch(`/api/payment-intents/${encodeURIComponent(intentId)}/select-network`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ network: asset.network }),
        signal: controller.signal
      })

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null)
        throw new Error(String(errorPayload?.error || "Failed to prepare payment details"))
      }
      const result = await res.json()
      const paymentUrl = String(result.paymentUrl || "")
      const derivedAddress = String(result.address || "")

      // Update state with actual payment data from API response
      setPaymentPayload({
        network: result.selectedNetwork || asset.network,
        usdTotalAmount: Number(result.grossAmount || intentPayload?.amount || 0),
        nativeAmount: Number(result.nativeAmount || 0),
        nativeSymbol: String(result.nativeSymbol || asset.symbol || "").toUpperCase(),
        paymentUrl,
        walletUrl: String(result.walletUrl || result.universalUrl || paymentUrl || ""),
        walletOptions: Array.isArray(result.walletOptions) ? result.walletOptions : [],
        qrCodeUrl: String(result.qrCodeUrl || ""),
        universalUrl: String(result.universalUrl || paymentUrl || ""),
        outputs: derivedAddress ? [{ address: derivedAddress, amount: result.nativeAmount || 0 }] : []
      })

      setSelectedNetwork(result.selectedNetwork || asset.network)
      setPaymentStatus((prev) => (String(prev || "").toUpperCase() ? prev : "PENDING"))

      if (!paymentUrl && !result.qrCodeUrl && !derivedAddress) {
        setSelectionError("No wallet address found for this payment method. Please try another asset.")
      }

    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Loading payment details timed out. Please try again."
          : error instanceof Error
            ? error.message
            : "Unable to load payment details"

      setSelectionError(message)

    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
      setIsLoading(false)
      setLoadingAssetId("")
    }
  }

  useEffect(() => {
    if (!intentId) return
    void loadIntentCallback()
  }, [intentId, loadIntentCallback])

  useEffect(() => {
    if (!intentId) return

    const interval = setInterval(() => {
      void loadIntentCallback()
    }, 3000)

    return () => clearInterval(interval)
  }, [intentId, loadIntentCallback])

  if (intentId && !intentPayload) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#e0ecff] via-[#f5f8ff] to-white">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-blue-100 p-7 text-center space-y-3">
          {intentLoadError ? (
            <>
              <p className="text-xs uppercase tracking-widest text-blue-500">PineTree Checkout</p>
              <h1 className="text-xl font-semibold text-slate-900">Unable to Load Payment</h1>
              <p className="text-sm text-slate-600">{intentLoadError}</p>
              <button
                onClick={() => { setIntentLoadError(""); void loadIntent() }}
                className="mt-2 px-5 py-2 bg-[#0052FF] text-white rounded-xl text-sm font-medium"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-widest text-blue-500">PineTree Checkout</p>
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#0052FF] border-t-transparent mx-auto" />
              <h1 className="text-lg font-semibold text-slate-900">Loading payment…</h1>
            </>
          )}
        </div>
      </main>
    )
  }

  if (!rawData && !intentPayload) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#e0ecff] via-[#f5f8ff] to-white">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-blue-100 p-7 text-center space-y-2">
          <p className="text-xs uppercase tracking-widest text-blue-500">PineTree Checkout</p>
          <h1 className="text-xl font-semibold text-slate-900">Invalid Payment Link</h1>
          <p className="text-sm text-slate-600">This QR code payload is missing or malformed.</p>
        </div>
      </main>
    )
  }

  const isIntentMode = Boolean(intentId && intentPayload)
  const displayAmount = isIntentMode
    ? Number(intentPayload?.amount || 0) + Number(intentPayload?.pinetreeFee || 0)
    : Number(payload?.usdTotalAmount ?? payload?.totalAmount ?? 0)

  if (isIntentMode && !selectedNetwork && !intentPayload?.availableNetworks?.length) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#e0ecff] via-[#f5f8ff] to-white">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-blue-100 p-7 text-center space-y-2">
          <p className="text-xs uppercase tracking-widest text-blue-500">PineTree Checkout</p>
          <h1 className="text-xl font-semibold text-slate-900">No Payment Methods Available</h1>
          <p className="text-sm text-slate-600">This merchant has no payment methods enabled.</p>
        </div>
      </main>
    )
  }

  if (isIntentMode && normalizedPaymentStatus === "CONFIRMED") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#e0ecff] via-[#f5f8ff] to-white">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-green-100 p-8 text-center space-y-4">
          <p className="text-xs uppercase tracking-widest text-blue-500">PineTree Checkout</p>
          <div className="flex justify-center">
            <svg className="w-16 h-16 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Payment Confirmed</h1>
          <p className="text-sm text-slate-500">Your payment was received successfully.</p>
        </div>
      </main>
    )
  }

  if (isIntentMode && (normalizedPaymentStatus === "FAILED" || normalizedPaymentStatus === "INCOMPLETE")) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#e0ecff] via-[#f5f8ff] to-white">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-red-100 p-8 text-center space-y-4">
          <p className="text-xs uppercase tracking-widest text-blue-500">PineTree Checkout</p>
          <div className="flex justify-center">
            <svg className="w-16 h-16 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Payment Failed</h1>
          <p className="text-sm text-slate-500">The payment was not received. Please try again or contact the merchant.</p>
        </div>
      </main>
    )
  }

  if (isIntentMode) {
    const displayStatus = getPaymentDisplayStatus(
      normalizedPaymentStatus,
      intentPayload ? new Date().toISOString() : new Date().toISOString()
    )

    const statusText = displayStatus.label

    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#e0ecff] via-[#f5f8ff] to-white">
        <div className="max-w-md w-full rounded-[2rem] border border-blue-100 bg-white shadow-2xl p-6 space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-500 mb-1">PineTree Checkout</p>
            <h1 className="text-2xl font-semibold text-slate-900">Choose Payment Asset</h1>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50 p-4 space-y-2 text-sm text-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-600">Subtotal</span>
              <span className="font-semibold">{formatUsd(Number(intentPayload?.amount || 0))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-600">PineTree Service Fee</span>
              <span className="font-semibold">{formatUsd(Number(intentPayload?.pinetreeFee || 0))}</span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-2">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="font-bold text-lg text-slate-900">{formatUsd(displayAmount)}</span>
            </div>
          </div>

          <div className="flex justify-center">
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${displayStatus.classes}`}>
              {statusText}
            </span>
          </div>

          <div className="space-y-3" ref={intentCardsRef}>
            <p className="text-sm font-medium text-slate-700">Select an asset to continue:</p>

          <div className="space-y-2">
            {getAvailableAssetsFromValues(intentPayload?.availableNetworks || []).map((assetId) => {
                const asset = ALLOWED_ASSETS[assetId]
                const isActive = selectedAssetId === assetId
                const isLoadingCard = loadingAssetId === assetId
                return (
                  <div key={assetId} className="rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => selectAsset(assetId)}
                      disabled={isLoading}
                      className={`w-full px-4 py-4 text-left transition disabled:opacity-50 ${
                        isActive
                          ? "bg-blue-50"
                          : "bg-white hover:bg-blue-50"
                      }`}
                    >
                      <span className="font-medium text-slate-900">Pay with {asset.label}</span>
                      <p className="text-xs text-slate-600 mt-1">Tap to reveal payment details</p>
                    </button>

                    {isActive && isLoadingCard ? (
                      <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-200">Loading payment details from merchant provider…</div>
                    ) : null}

                    {isActive && !isLoadingCard ? (
                      <div className="px-4 py-4 border-t border-slate-200 bg-white space-y-3">
                        {selectionError ? (
                          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            {selectionError}
                          </div>
                        ) : null}

                        {paymentPayload && recipientAddress ? (
                          <>
                            {String(paymentPayload.nativeSymbol || "").toUpperCase() && Number.isFinite(Number(paymentPayload.nativeAmount || 0)) && Number(paymentPayload.nativeAmount || 0) > 0 ? (
                              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                Send exactly <span className="font-semibold">{Number(paymentPayload.nativeAmount || 0)} {String(paymentPayload.nativeSymbol || "").toUpperCase()}</span>.
                                Do not send only a USD estimate from wallet conversion.
                              </div>
                            ) : null}
                            <div className="text-[11px] uppercase tracking-wider text-slate-500">Payment Address</div>
                            <div className="text-xs font-mono break-all bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-slate-700">
                              {recipientAddress}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={copyAddress}
                                className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium"
                              >
                                {copiedAddress ? "Address Copied" : "Copy Address"}
                              </button>
                              <button
                                onClick={() => copyAmount(Number(paymentPayload.nativeAmount || 0))}
                                className="w-full rounded-lg border border-blue-200 bg-blue-50 text-blue-700 py-2 text-sm font-medium"
                              >
                                {copiedAmount ? "Amount Copied" : "Copy Amount"}
                              </button>
                            </div>
                          </>
                        ) : null}

                        {paymentPayload && walletOptions.length > 0 ? (
                          <div className="space-y-2">
                            <div className="text-[11px] uppercase tracking-wider text-slate-500">Wallet Apps</div>
                            <div className="grid grid-cols-2 gap-2">
                              {walletOptions.map((option) => (
                                <button
                                  key={option.id}
                                  onClick={() => {
                                    window.location.href = option.href
                                  }}
                                  className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {!selectionError && !paymentPayload ? (
                          <div className="text-xs text-slate-500">Tap the asset again to retry loading payment details.</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => window.close()}
              className="w-full text-sm text-red-600 hover:text-red-700 mt-2"
            >
              Cancel
            </button>
          </div>
        </div>
      </main>
    )
  }



  const network = String(activePayload?.network || selectedNetwork || "unknown").toUpperCase()
  const usdTotalAmount = Number(activePayload?.usdTotalAmount ?? activePayload?.totalAmount ?? 0)
  const nativeAmount = Number(activePayload?.nativeAmount ?? 0)
  const nativeSymbol = String(activePayload?.nativeSymbol || "").toUpperCase()

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
      <div className="max-w-md w-full rounded-[2rem] border border-blue-100 bg-white shadow-2xl p-6 space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">PineTree</p>
          <h1 className="text-2xl font-semibold text-slate-900">Complete Payment</h1>
        </div>

        <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50 p-4 space-y-2 text-sm text-slate-800">
          <div className="flex items-center justify-between"><span className="font-medium text-slate-600">Network</span><span className="font-semibold">{network}</span></div>
          <div className="flex items-center justify-between"><span className="font-medium text-slate-600">Total</span><span className="font-semibold">{formatUsd(usdTotalAmount)}</span></div>
          {nativeSymbol ? (
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-600">Pay Amount</span>
              <span className="font-semibold">{Number.isFinite(nativeAmount) ? nativeAmount : 0} {nativeSymbol}</span>
            </div>
          ) : null}
          {nativeSymbol && Number.isFinite(nativeAmount) && nativeAmount > 0 ? (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-2">
              Send the exact crypto amount shown. Wallet USD conversion can underpay and prevent confirmation.
            </div>
          ) : null}
        </div>

        {paymentQrUrl ? (
          <div className="flex flex-col items-center rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
            <p className="text-xs uppercase tracking-wider text-blue-600 mb-3">Scan QR to Pay</p>
            <Image src={paymentQrUrl} alt="Payment QR" width={208} height={208} className="h-52 w-52 rounded-xl bg-white p-2" />
          </div>
        ) : null}

        {recipientAddress ? (
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-slate-500">Payment Address</label>
            <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 break-all font-mono">
              {recipientAddress}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={copyAddress}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {copiedAddress ? "Address Copied" : "Copy Address"}
              </button>
              <button
                onClick={() => copyAmount(nativeAmount)}
                className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                {copiedAmount ? "Amount Copied" : "Copy Amount"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <label className="text-sm font-medium text-slate-700">Select your wallet:</label>

          <select
            value={selectedWalletId}
            onChange={(e) => setSelectedWalletId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-900"
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
            <button
              onClick={() => {
                if (!selectedWallet?.href) return
                window.location.href = selectedWallet.href
              }}
              className={`block w-full text-center rounded-xl py-3 font-medium transition ${
                selectedWallet
                  ? "bg-[#0A84FF] text-white shadow hover:brightness-110"
                  : "bg-slate-200 text-slate-500 pointer-events-none"
              }`}
            >
              Open {selectedWallet?.label}
            </button>
          ) : null}

          {selectedWalletId === "manual" ? (
            <button
              onClick={copyWalletUrl}
              className="w-full rounded-xl bg-[#0A84FF] text-white px-4 py-3 font-medium shadow hover:brightness-110 transition"
            >
              {copiedLink ? "Copied ✓" : "Copy Payment Address"}
            </button>
          ) : null}
        </div>

        {walletUrl ? (
          <button
            onClick={copyWalletUrl}
            className="w-full text-center border border-slate-300 rounded-xl py-2 text-sm text-slate-700"
          >
            {copiedLink ? "Copied" : "Copy Wallet Address"}
          </button>
        ) : null}

        {primaryOpenUrl ? (
          <button
            onClick={() => {
              window.location.href = primaryOpenUrl
            }}
            className="w-full rounded-xl bg-blue-600 text-white px-4 py-3 font-medium shadow hover:brightness-110 transition"
          >
            Open in Wallet App
          </button>
        ) : null}

        <button
          onClick={() => {
            setSelectedNetwork(null)
            setSelectedWalletId("")
            setPaymentPayload(null)
          }}
          className="w-full text-sm text-red-600 hover:text-red-700 text-center"
        >
          Cancel
        </button>
      </div>
    </main>
  )
}