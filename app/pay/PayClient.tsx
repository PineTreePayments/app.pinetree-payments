"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ALLOWED_ASSETS, getAvailableAssetsFromValues } from "@/engine/providerMappings"

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
  qrCodeUrl?: string
  universalUrl?: string
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
  icon?: string
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

function roundAmount(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

function toWeiString(amountEth: number): string {
  const safe = Number.isFinite(amountEth) && amountEth > 0 ? amountEth : 0
  const [whole, fraction = ""] = safe.toFixed(18).split(".")
  const normalized = `${whole}${fraction.padEnd(18, "0").slice(0, 18)}`.replace(/^0+/, "")
  return normalized || "0"
}

function buildWalletUrl(payload: SplitPayload, rawData: string) {
  const network = String(payload.network || "").toLowerCase()
  const explicitPaymentUrl = String(payload.paymentUrl || "").trim()
  const recipient = String(payload.outputs?.[0]?.address || "")
  const usdTotal = Number(payload.usdTotalAmount ?? payload.totalAmount ?? 0)
  const nativeAmountRaw = Number(payload.nativeAmount ?? 0)
  const nativeAmount = Number.isFinite(nativeAmountRaw) && nativeAmountRaw > 0 ? nativeAmountRaw : usdTotal
  const reference = String(payload.reference || "")

  if (network === "solana") {
    // For Solana split payments, prefer transaction-request URL so wallets execute
    // the server-generated split transaction instead of a direct merchant transfer.
    if (explicitPaymentUrl.startsWith("http://") || explicitPaymentUrl.startsWith("https://")) {
      return explicitPaymentUrl
    }

    if (!recipient) return ""

    const query = new URLSearchParams()
    if (Number.isFinite(nativeAmount) && nativeAmount > 0) {
      query.set("amount", String(roundAmount(nativeAmount, 9)))
    }
    if (reference) query.set("reference", reference)
    query.set("label", "PineTree Payments")
    query.set("message", reference ? `PineTree Checkout #${reference.slice(0, 8)}` : "Pay securely with PineTree")

    const qs = query.toString()
    return qs ? `solana:${recipient}?${qs}` : `solana:${recipient}`
  }

  if (network === "base" || network === "base_pay" || network === "ethereum") {
    if (!recipient) return ""
    const chainId = network === "ethereum" ? "1" : "8453"
    return `ethereum:${recipient}@${chainId}?value=${toWeiString(nativeAmount)}`
  }

  return `pinetree://pay?data=${encodeURIComponent(rawData)}`
}

function buildWalletOptions(walletUrl: string): WalletOption[] {
  if (!walletUrl) return []

  const encodedWalletUrl = encodeURIComponent(walletUrl)

  // Unified wallet app list for all networks (multi-chain wallet support)
  return [
    {
      id: "phantom",
      label: "Phantom",
      href: `https://phantom.app/ul/browse/${encodedWalletUrl}`
    },
    {
      id: "solflare",
      label: "Solflare",
      href: `https://solflare.com/ul/v1/browse/${encodedWalletUrl}`
    },
    {
      id: "metamask",
      label: "MetaMask",
      href: `metamask://dapp?url=${encodedWalletUrl}`
    },
    {
      id: "basewallet",
      label: "Base Wallet",
      href: `cbwallet://dapp?url=${encodedWalletUrl}`
    },
    {
      id: "coinbase",
      label: "Coinbase App",
      href: `https://go.cb-w.com/dapp?cb_url=${encodedWalletUrl}`
    },
    {
      id: "trust",
      label: "Trust Wallet",
      href: `https://link.trustwallet.com/open_url?url=${encodedWalletUrl}`
    }
  ]
}

function extractAddressFromPaymentUrl(paymentUrl?: string): string {
  const raw = String(paymentUrl || "")
  if (!raw) return ""

  if (raw.startsWith("solana:")) {
    const value = raw.slice("solana:".length)
    return value.split("?")[0] || ""
  }

  if (raw.startsWith("ethereum:")) {
    const value = raw.slice("ethereum:".length)
    return value.split("@")[0] || ""
  }

  return ""
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
  const [paymentPayload, setPaymentPayload] = useState<SplitPayload | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  
  const payload = useMemo(() => parsePayload(rawData), [rawData])
  const activePayload = paymentPayload || payload
  
  const walletUrl = useMemo(
    () => (activePayload ? buildWalletUrl(activePayload, rawData || "") : ""),
    [activePayload, rawData]
  )
  const walletOptions = useMemo(
    () => (activePayload ? buildWalletOptions(walletUrl) : []),
    [activePayload, walletUrl]
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
      if (!res.ok || ("error" in payload && payload.error)) return
      const intent = payload as IntentPayload
      setIntentPayload(intent)
      setPaymentStatus(String(intent.paymentStatus || ""))
    } catch {
      // ignore
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
      const derivedAddress = String(result.address || extractAddressFromPaymentUrl(paymentUrl))

      // Update state with actual payment data from API response
      setPaymentPayload({
        network: result.selectedNetwork || asset.network,
        usdTotalAmount: Number(intentPayload?.amount || 0) + Number(intentPayload?.pinetreeFee || 0),
        nativeAmount: Number(result.nativeAmount || 0),
        nativeSymbol: String(result.nativeSymbol || asset.symbol || "").toUpperCase(),
        paymentUrl,
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
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
        <div className="max-w-md w-full bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-white p-7 text-center">
          <h1 className="text-xl font-semibold mb-2 text-slate-900">Loading payment…</h1>
        </div>
      </main>
    )
  }

  if (!rawData && !intentPayload) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
        <div className="max-w-md w-full bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-white p-7 text-center">
          <h1 className="text-xl font-semibold mb-2 text-slate-900">Invalid payment QR</h1>
          <p className="text-sm text-slate-700">This QR code payload is missing or malformed.</p>
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
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
        <div className="max-w-md w-full bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-white p-7 text-center">
          <h1 className="text-xl font-semibold mb-2 text-slate-900">No payment methods available</h1>
          <p className="text-sm text-slate-700">This merchant has no payment methods enabled.</p>
        </div>
      </main>
    )
  }

  if (isIntentMode) {
    const statusText = (() => {
      if (!normalizedPaymentStatus) return "Waiting for payment to start"
      if (normalizedPaymentStatus === "CREATED") return "Payment created, waiting for on-chain transaction"
      if (normalizedPaymentStatus === "PENDING") return "Waiting for blockchain confirmation"
      if (normalizedPaymentStatus === "PROCESSING") return "Payment detected, processing confirmation"
      if (normalizedPaymentStatus === "CONFIRMED") return "Payment confirmed"
      if (normalizedPaymentStatus === "FAILED") return "Payment failed"
      if (normalizedPaymentStatus === "INCOMPLETE" || normalizedPaymentStatus === "EXPIRED") return "Payment incomplete or expired"
      return `Payment status: ${normalizedPaymentStatus}`
    })()

    const statusTone =
      normalizedPaymentStatus === "CONFIRMED"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : normalizedPaymentStatus === "FAILED" || normalizedPaymentStatus === "INCOMPLETE" || normalizedPaymentStatus === "EXPIRED"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-blue-200 bg-blue-50 text-blue-700"

    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-[#e0ecff] via-[#f5f8ff] to-white">
        <div className="max-w-md w-full rounded-[2rem] border border-blue-100 bg-white shadow-2xl p-6 space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-500 mb-1">PineTree Checkout</p>
            <h1 className="text-2xl font-semibold text-slate-900">Choose Payment Asset</h1>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50 p-4 space-y-2 text-sm text-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-600">Total</span>
              <span className="font-semibold text-lg">{formatUsd(displayAmount)}</span>
            </div>
          </div>

          <div className={`rounded-xl border px-3 py-2 text-sm font-medium ${statusTone}`}>
            {statusText}
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
            <img src={paymentQrUrl} alt="Payment QR" className="h-52 w-52 rounded-xl bg-white p-2" />
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