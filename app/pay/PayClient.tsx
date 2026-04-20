"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import { ALLOWED_ASSETS, getAvailableAssetsFromValues } from "@/engine/providerMappings"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import PageContainer from "@/components/ui/PageContainer"
import StatusBadge from "@/components/ui/StatusBadge"

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
    // Only poll once a payment has been initiated (network selected or intent already
    // has a linked paymentId). Skip polling on the asset-selection screen to avoid
    // unnecessary RPC/DB load before the customer has even chosen a network.
    const hasActivePayment = Boolean(selectedNetwork || intentPayload?.paymentId)
    if (!hasActivePayment) return
    // Stop polling once a terminal status is reached — no further status changes possible.
    const isTerminal = normalizedPaymentStatus === "CONFIRMED" ||
      normalizedPaymentStatus === "FAILED" ||
      normalizedPaymentStatus === "INCOMPLETE"
    if (isTerminal) return

    const interval = setInterval(() => {
      void loadIntentCallback()
    }, 5000)

    return () => clearInterval(interval)
  }, [intentId, loadIntentCallback, selectedNetwork, intentPayload?.paymentId, normalizedPaymentStatus])

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

  if (!rawData && !intentPayload) {
    return (
      <PageContainer>
        <Card className="max-w-md w-full text-center space-y-3">
          <p className="text-xs uppercase tracking-widest text-gray-500">PineTree Checkout</p>
          <h1 className="text-xl font-bold text-gray-900">Invalid Payment Link</h1>
          <p className="text-sm text-gray-500">This QR code payload is missing or malformed.</p>
        </Card>
      </PageContainer>
    )
  }

  const isIntentMode = Boolean(intentId && intentPayload)
  const displayAmount = isIntentMode
    ? Number(intentPayload?.amount || 0) + Number(intentPayload?.pinetreeFee || 0)
    : Number(payload?.usdTotalAmount ?? payload?.totalAmount ?? 0)

  if (isIntentMode && !selectedNetwork && !intentPayload?.availableNetworks?.length) {
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
      intentPayload ? new Date().toISOString() : new Date().toISOString()
    )

    const statusText = displayStatus.label

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
            <StatusBadge label={statusText} classes={`${displayStatus.classes} px-3 py-1.5 text-sm`} />
          </div>

          <div className="space-y-3" ref={intentCardsRef}>
            <p className="text-xs uppercase tracking-widest text-gray-500">Select an asset to continue:</p>

          <div className="space-y-2">
            {getAvailableAssetsFromValues(intentPayload?.availableNetworks || []).map((assetId) => {
                const asset = ALLOWED_ASSETS[assetId]
                const isActive = selectedAssetId === assetId
                const isLoadingCard = loadingAssetId === assetId
                return (
                  <div key={assetId} className="rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => selectAsset(assetId)}
                      disabled={isLoading}
                      className={`w-full px-4 py-4 text-left transition disabled:opacity-50 ${
                        isActive
                          ? "bg-blue-50"
                          : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      <span className="font-medium text-gray-900">Pay with {asset.label}</span>
                      <p className="text-xs text-gray-500 mt-1">Tap to reveal payment details</p>
                    </button>

                    {isActive && isLoadingCard ? (
                      <div className="px-4 py-3 text-xs text-gray-500 border-t border-gray-200">Loading payment details from merchant provider…</div>
                    ) : null}

                    {isActive && !isLoadingCard ? (
                      <div className="px-4 py-4 border-t border-gray-200 bg-white space-y-4">
                        {selectionError ? (
                          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                            {selectionError}
                          </div>
                        ) : null}

                        {paymentPayload && paymentPayload.qrCodeUrl ? (
                          <div className="flex flex-col items-center space-y-2">
                            <div className="text-xs uppercase tracking-widest text-gray-500">
                              {String(paymentPayload.network || "").toLowerCase() === "solana"
                                ? "Open Phantom → Scanner → Scan"
                                : "Open MetaMask or Coinbase Wallet → Scan"}
                            </div>
                            <div className="bg-white border border-gray-200 rounded-xl p-2">
                              <Image
                                src={paymentPayload.qrCodeUrl}
                                alt="Scan with wallet app"
                                width={180}
                                height={180}
                                className="rounded-lg"
                              />
                            </div>
                            <p className="text-xs text-gray-500 text-center">
                              {String(paymentPayload.nativeAmount || 0)} {String(paymentPayload.nativeSymbol || "").toUpperCase()} · {formatUsd(Number(paymentPayload.usdTotalAmount || 0))}
                            </p>
                          </div>
                        ) : null}

                        {paymentPayload?.outputs?.[0]?.address ? (
                          <div className="space-y-2">
                            <label className="text-xs uppercase tracking-widest text-gray-500">Payment Address</label>
                            <div className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 break-all font-mono">
                              {paymentPayload.outputs[0].address}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Button onClick={copyAddress}>
                                {copiedAddress ? "Address Copied" : "Copy Address"}
                              </Button>
                              <Button variant="secondary" onClick={() => copyAmount(paymentPayload.nativeAmount)}>
                                {copiedAmount ? "Amount Copied" : "Copy Amount"}
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        {paymentPayload && String(paymentPayload.paymentUrl || "").match(/^(solana:|ethereum:)/) ? (
                          <Button
                            fullWidth
                            onClick={() => { window.location.href = String(paymentPayload.paymentUrl || "") }}
                          >
                            Open in Wallet App
                          </Button>
                        ) : null}

                        {!selectionError && !paymentPayload ? (
                          <div className="text-xs text-gray-500">Tap the asset again to retry loading payment details.</div>
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

        {paymentQrUrl ? (
          <div className="flex flex-col items-center rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">Scan QR to Pay</p>
            <Image src={paymentQrUrl} alt="Payment QR" width={208} height={208} className="h-52 w-52 rounded-xl bg-white p-2" />
          </div>
        ) : null}

        {recipientAddress ? (
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

        {walletUrl ? (
          <Button variant="secondary" fullWidth onClick={copyWalletUrl}>
            {copiedLink ? "Copied" : "Copy Wallet Address"}
          </Button>
        ) : null}

        {primaryOpenUrl ? (
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
