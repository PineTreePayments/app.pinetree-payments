"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

type SplitOutput = {
  address: string
  amount: number
}

type SplitPayload = {
  type?: string
  network?: string
  reference?: string
  outputs?: SplitOutput[]
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
  checkoutUrl?: string
}

type WalletOption = {
  id: string
  label: string
  href: string
  description?: string
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
  const recipient = String(payload.outputs?.[0]?.address || "")
  const usdTotal = Number(payload.usdTotalAmount ?? payload.totalAmount ?? 0)
  const nativeAmountRaw = Number(payload.nativeAmount ?? 0)
  const nativeAmount = Number.isFinite(nativeAmountRaw) && nativeAmountRaw > 0 ? nativeAmountRaw : usdTotal
  const reference = String(payload.reference || "")

  if (!recipient) return ""

  if (network === "solana") {
    const query = new URLSearchParams()
    if (Number.isFinite(nativeAmount) && nativeAmount > 0) {
      query.set("amount", String(roundAmount(nativeAmount, 9)))
    }
    if (reference) query.set("reference", reference)
    query.set("label", "PineTree Payment")
    query.set("message", reference ? `Payment #${reference.slice(0, 8)}` : "PineTree Payment")

    const qs = query.toString()
    return qs ? `solana:${recipient}?${qs}` : `solana:${recipient}`
  }

  if (network === "base" || network === "base_pay" || network === "ethereum") {
    const chainId = network === "ethereum" ? "1" : "8453"
    return `ethereum:${recipient}@${chainId}?value=${toWeiString(nativeAmount)}`
  }

  return `pinetree://pay?data=${encodeURIComponent(rawData)}`
}

function buildMetaMaskHref(payload: SplitPayload): string | null {
  const recipient = String(payload.outputs?.[0]?.address || "")
  const network = String(payload.network || "").toLowerCase()
  const usdTotal = Number(payload.usdTotalAmount ?? payload.totalAmount ?? 0)
  const nativeAmountRaw = Number(payload.nativeAmount ?? 0)
  const nativeAmount = Number.isFinite(nativeAmountRaw) && nativeAmountRaw > 0 ? nativeAmountRaw : usdTotal

  if (!recipient || nativeAmount <= 0) return null

  const chainId = network === "ethereum" ? "1" : "8453"
  const value = toWeiString(nativeAmount)
  return `https://metamask.app.link/send/${recipient}@${chainId}?value=${value}`
}

function buildWalletOptions(payload: SplitPayload, walletUrl: string): WalletOption[] {
  const network = String(payload.network || "").toLowerCase()
  if (!walletUrl) return []

  const encodedWalletUrl = encodeURIComponent(walletUrl)

  if (network === "solana") {
    const encodedRef = encodeURIComponent("https://app.pinetree-payments.com")

    return [
      {
        id: "phantom",
        label: "Phantom",
        description: "Recommended for Solana Pay",
        href: `https://phantom.app/ul/v1/browse/${encodedWalletUrl}?ref=${encodedRef}`
      },
      {
        id: "solflare",
        label: "Solflare",
        description: "Open with Solflare app",
        href: `https://solflare.com/ul/v1/browse/${encodedWalletUrl}?ref=${encodedRef}`
      },
      {
        id: "trust",
        label: "Trust Wallet",
        description: "Open using Trust deep link",
        href: `https://link.trustwallet.com/open_url?url=${encodedWalletUrl}`
      },
      {
        id: "other",
        label: "Other Solana Wallet",
        description: "Use raw Solana URI",
        href: walletUrl
      }
    ]
  }

  if (network === "base" || network === "base_pay" || network === "ethereum") {
    const metamaskHref = buildMetaMaskHref(payload)

    return [
      {
        id: "base",
        label: "Base Wallet",
        description: "Open with Base-compatible wallet handler",
        href: walletUrl
      },
      ...(metamaskHref
        ? [
            {
              id: "metamask",
              label: "MetaMask",
              description: "Open directly in MetaMask",
              href: metamaskHref
            }
          ]
        : []),
      {
        id: "coinbase",
        label: "Coinbase Wallet",
        description: "Open in Coinbase Wallet",
        href: `https://go.cb-w.com/dapp?cb_url=${encodedWalletUrl}`
      },
      {
        id: "trust",
        label: "Trust Wallet",
        description: "Open using Trust deep link",
        href: `https://link.trustwallet.com/open_url?url=${encodedWalletUrl}`
      },
      {
        id: "other",
        label: "Other EVM Wallet",
        description: "Use raw ethereum URI",
        href: walletUrl
      }
    ]
  }

  return [
    {
      id: "default",
      label: "Wallet",
      description: "Open wallet link",
      href: walletUrl
    }
  ]
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
  const [copiedRef, setCopiedRef] = useState(false)
  const [selectedWalletId, setSelectedWalletId] = useState("")
  const [selectedNetwork, setSelectedNetwork] = useState("")
  const [intentPayload, setIntentPayload] = useState<IntentPayload | null>(null)
  const [isSubmittingIntent, setIsSubmittingIntent] = useState(false)

  const payload = useMemo(() => parsePayload(rawData), [rawData])
  const walletUrl = useMemo(
    () => (rawData && payload ? buildWalletUrl(payload, rawData) : ""),
    [payload, rawData]
  )
  const walletOptions = useMemo(() => (payload ? buildWalletOptions(payload, walletUrl) : []), [payload, walletUrl])
  const resolvedSelectedWalletId = walletOptions.some((option) => option.id === selectedWalletId)
    ? selectedWalletId
    : ""
  const selectedWallet = useMemo(
    () => walletOptions.find((option) => option.id === resolvedSelectedWalletId) || null,
    [walletOptions, resolvedSelectedWalletId]
  )

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

  async function copyReference(reference: string) {
    try {
      await navigator.clipboard.writeText(reference)
      setCopiedRef(true)
      setTimeout(() => setCopiedRef(false), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  const isIntentMode = Boolean(intentId)

  async function loadIntent() {
    if (!intentId) return
    try {
      const res = await fetch(`/api/payment-intents/${encodeURIComponent(intentId)}`, { cache: "no-store" })
      const payload = (await res.json()) as IntentPayload | { error?: string }
      if (!res.ok || ("error" in payload && payload.error)) return
      setIntentPayload(payload as IntentPayload)
    } catch {
      // ignore
    }
  }

  async function selectIntentNetwork() {
    if (!intentId || !selectedNetwork) return
    try {
      setIsSubmittingIntent(true)
      const res = await fetch(`/api/payment-intents/${encodeURIComponent(intentId)}/select-network`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ network: selectedNetwork })
      })

      if (!res.ok) return
      const payload = await res.json()
      if (payload?.universalUrl) {
        window.location.href = payload.universalUrl
        return
      }
      if (payload?.paymentUrl) {
        window.location.href = payload.paymentUrl
        return
      }
      await loadIntent()
    } finally {
      setIsSubmittingIntent(false)
    }
  }

  useEffect(() => {
    if (!isIntentMode) return
    void loadIntent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIntentMode, intentId])

  if (isIntentMode && intentPayload) {
    const available = intentPayload.availableNetworks || []
    const hasSelected = Boolean(intentPayload.selectedNetwork && intentPayload.paymentId)

    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
        <div className="max-w-md w-full rounded-[2rem] border border-white/70 bg-white/80 backdrop-blur-xl shadow-2xl p-6 space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">PineTree</p>
            <h1 className="text-2xl font-semibold text-slate-900">Choose payment network</h1>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50 p-4 space-y-2 text-sm text-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-600">Total</span>
              <span className="font-semibold">{formatUsd(Number(intentPayload.amount || 0) + Number(intentPayload.pinetreeFee || 0))}</span>
            </div>
            <div className="text-xs text-slate-600">Intent: {intentPayload.intentId.slice(0, 10)}...{intentPayload.intentId.slice(-6)}</div>
          </div>

          {hasSelected ? (
            <div className="text-sm text-emerald-700">Network already selected. Continue in wallet.</div>
          ) : (
            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-700">Available networks</label>
              <select
                value={selectedNetwork}
                onChange={(e) => setSelectedNetwork(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-900"
              >
                <option value="">Select network…</option>
                {available.map((n) => (
                  <option key={n} value={n}>{String(n).toUpperCase()}</option>
                ))}
              </select>

              <button
                onClick={selectIntentNetwork}
                disabled={!selectedNetwork || isSubmittingIntent}
                className={`block w-full text-center rounded-xl py-3 font-medium transition ${
                  selectedNetwork && !isSubmittingIntent
                    ? "bg-[#0A84FF] text-white shadow hover:brightness-110"
                    : "bg-slate-200 text-slate-500"
                }`}
              >
                {isSubmittingIntent ? "Starting payment..." : "Continue"}
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  if (isIntentMode) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
        <div className="max-w-md w-full bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-white p-7 text-center">
          <h1 className="text-xl font-semibold mb-2 text-slate-900">Loading payment options…</h1>
        </div>
      </main>
    )
  }

  if (!rawData || !payload) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
        <div className="max-w-md w-full bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-white p-7 text-center">
          <h1 className="text-xl font-semibold mb-2 text-slate-900">Invalid payment QR</h1>
          <p className="text-sm text-slate-700">This QR code payload is missing or malformed.</p>
        </div>
      </main>
    )
  }

  const network = String(payload.network || "unknown").toUpperCase()
  const usdTotalAmount = Number(payload.usdTotalAmount ?? payload.totalAmount ?? 0)
  const nativeAmount = Number(payload.nativeAmount ?? 0)
  const nativeSymbol = String(payload.nativeSymbol || "").toUpperCase()
  const quotePriceUsd = Number(payload.quotePriceUsd ?? 0)
  const reference = String(payload.reference || "")
  const shortRef = reference ? `${reference.slice(0, 10)}...${reference.slice(-6)}` : ""

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
      <div className="max-w-md w-full rounded-[2rem] border border-white/70 bg-white/80 backdrop-blur-xl shadow-2xl p-6 space-y-5">
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
          {quotePriceUsd > 0 ? (
            <div className="text-xs text-slate-600">Quote: 1 {nativeSymbol} ≈ {formatUsd(quotePriceUsd)}</div>
          ) : null}
          {reference ? (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-slate-600">Ref {shortRef}</span>
              <button
                onClick={() => copyReference(reference)}
                className="text-xs rounded-full border border-slate-300 px-2 py-1 text-slate-700"
              >
                {copiedRef ? "Copied" : "Copy Ref"}
              </button>
            </div>
          ) : null}
        </div>

        {walletOptions.length > 0 ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Choose wallet</label>
              <select
                value={resolvedSelectedWalletId}
                onChange={(e) => setSelectedWalletId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-900"
              >
                <option value="">Select a wallet…</option>
                {walletOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {selectedWallet?.description ? (
                <p className="text-xs text-slate-600">{selectedWallet.description}</p>
              ) : null}
            </div>

            <a
              href={selectedWallet?.href || "#"}
              aria-disabled={!selectedWallet}
              className={`block w-full text-center rounded-xl py-3 font-medium transition ${
                selectedWallet
                  ? "bg-[#0A84FF] text-white shadow hover:brightness-110"
                  : "bg-slate-200 text-slate-500 pointer-events-none"
              }`}
            >
              {selectedWallet ? `Open in ${selectedWallet.label}` : "Select a wallet first"}
            </a>
          </div>
        ) : (
          <div className="text-sm text-red-700">Could not generate wallet deep link.</div>
        )}

        {walletUrl ? (
          <button
            onClick={copyWalletUrl}
            className="w-full text-center border border-slate-300 rounded-xl py-2 text-sm text-slate-700"
          >
            {copiedLink ? "Copied" : "Copy Wallet Link"}
          </button>
        ) : null}

        {payload.redirect ? (
          <a href={payload.redirect} className="block text-center text-sm text-slate-600 underline">
            Return to merchant
          </a>
        ) : null}
      </div>
    </main>
  )
}
