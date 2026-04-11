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

function buildWalletOptions(network: string, walletUrl: string): WalletOption[] {
  if (!walletUrl) return []

  const encodedWalletUrl = encodeURIComponent(walletUrl)

  if (network === "solana") {
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
        id: "trust",
        label: "Trust Wallet",
        href: `https://link.trustwallet.com/open_url?url=${encodedWalletUrl}`
      }
    ]
  }

  if (network === "base" || network === "ethereum") {
    return [
      {
        id: "basewallet",
        label: "Base Wallet",
        href: `cbwallet://dapp?url=${encodedWalletUrl}`
      },
      {
        id: "metamask",
        label: "MetaMask",
        href: `metamask://dapp?url=${encodedWalletUrl}`
      },
      {
        id: "trust",
        label: "Trust Wallet",
        href: `trust://dapp?url=${encodedWalletUrl}`
      },
      {
        id: "coinbase",
        label: "Coinbase Wallet",
        href: `https://go.cb-w.com/dapp?cb_url=${encodedWalletUrl}`
      }
    ]
  }

  return []
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
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null)
  const [intentPayload, setIntentPayload] = useState<IntentPayload | null>(null)
  const [paymentPayload, setPaymentPayload] = useState<SplitPayload | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const payload = useMemo(() => parsePayload(rawData), [rawData])
  const activePayload = paymentPayload || payload
  
  const walletUrl = useMemo(
    () => (activePayload ? buildWalletUrl(activePayload, rawData || "") : ""),
    [activePayload, rawData]
  )
  const walletOptions = useMemo(() => (activePayload && selectedNetwork ? buildWalletOptions(selectedNetwork, walletUrl) : []), [activePayload, walletUrl, selectedNetwork])

  const [selectedWalletId, setSelectedWalletId] = useState("")

  const resolvedSelectedWalletId = useMemo(() => {
    return walletOptions.some((option) => option.id === selectedWalletId)
      ? selectedWalletId
      : ""
  }, [walletOptions, selectedWalletId])

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

  async function selectNetwork(network: string) {
    if (!intentId) return
    setIsLoading(true)

    try {
      const res = await fetch(`/api/payment-intents/${encodeURIComponent(intentId)}/select-network`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ network })
      })

      if (!res.ok) return
      const result = await res.json()

      // Update state with actual payment data from API response
      setPaymentPayload({
        network: result.selectedNetwork,
        usdTotalAmount: Number(intentPayload?.amount || 0) + Number(intentPayload?.pinetreeFee || 0),
        outputs: result.address ? [{ address: result.address, amount: result.nativeAmount || 0 }] : []
      })

      setSelectedNetwork(network)

      // Attempt to open wallet automatically if universalUrl is present
      if (result.universalUrl || result.paymentUrl) {
        try {
          window.location.href = result.universalUrl || result.paymentUrl
        } catch {}
      }

    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!intentId) return
    void loadIntent()
  }, [intentId])

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

  if (isIntentMode && !selectedNetwork) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-100 via-slate-50 to-white">
        <div className="max-w-md w-full rounded-[2rem] border border-white/70 bg-white/80 backdrop-blur-xl shadow-2xl p-6 space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">PineTree</p>
            <h1 className="text-2xl font-semibold text-slate-900">Complete Payment</h1>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50 p-4 space-y-2 text-sm text-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-600">Total</span>
              <span className="font-semibold text-lg">{formatUsd(displayAmount)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">Choose how you want to pay:</p>

            <div className="space-y-2">
              {intentPayload?.availableNetworks.map((network) => (
                <button
                  key={network}
                  onClick={() => selectNetwork(network)}
                  disabled={isLoading}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-4 text-left hover:bg-blue-50 hover:border-blue-400 transition disabled:opacity-50"
                >
                  <span className="font-medium text-slate-900">Pay with {String(network).toUpperCase()}</span>
                  <p className="text-xs text-slate-600 mt-1">Opens your {String(network)} wallet app directly</p>
                </button>
              ))}
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



  const network = String(payload?.network || selectedNetwork || "unknown").toUpperCase()
  const usdTotalAmount = Number(payload?.usdTotalAmount ?? payload?.totalAmount ?? 0)
  const nativeAmount = Number(payload?.nativeAmount ?? 0)
  const nativeSymbol = String(payload?.nativeSymbol || "").toUpperCase()

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
        </div>

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
            <a
              href={selectedWallet?.href || "#"}
              className={`block w-full text-center rounded-xl py-3 font-medium transition ${
                selectedWallet
                  ? "bg-[#0A84FF] text-white shadow hover:brightness-110"
                  : "bg-slate-200 text-slate-500 pointer-events-none"
              }`}
            >
              Open {selectedWallet?.label}
            </a>
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