"use client"

import { useMemo, useState } from "react"
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

type WalletOption = {
  label: string
  href: string
  tone?: "primary" | "secondary"
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

function buildWalletOptions(payload: SplitPayload, walletUrl: string): WalletOption[] {
  const network = String(payload.network || "").toLowerCase()
  if (!walletUrl) return []

  if (network === "solana") {
    const encodedWalletUrl = encodeURIComponent(walletUrl)
    const encodedRef = encodeURIComponent("https://app.pinetree-payments.com")

    return [
      { label: "Open in Installed Solana Wallet", href: walletUrl, tone: "primary" },
      {
        label: "Open in Phantom",
        href: `https://phantom.app/ul/v1/browse/${encodedWalletUrl}?ref=${encodedRef}`,
        tone: "secondary"
      },
      {
        label: "Open in Solflare",
        href: `https://solflare.com/ul/v1/browse/${encodedWalletUrl}?ref=${encodedRef}`,
        tone: "secondary"
      },
      {
        label: "Open in Trust Wallet",
        href: `https://link.trustwallet.com/open_url?url=${encodedWalletUrl}`,
        tone: "secondary"
      }
    ]
  }

  return [{ label: "Open Wallet", href: walletUrl, tone: "primary" }]
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
  const [copied, setCopied] = useState(false)

  const payload = useMemo(() => parsePayload(rawData), [rawData])
  const walletUrl = useMemo(
    () => (rawData && payload ? buildWalletUrl(payload, rawData) : ""),
    [payload, rawData]
  )
  const walletOptions = useMemo(() => (payload ? buildWalletOptions(payload, walletUrl) : []), [payload, walletUrl])

  async function copyWalletUrl() {
    if (!walletUrl) return
    try {
      await navigator.clipboard.writeText(walletUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  if (!rawData || !payload) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-gray-100">
        <div className="max-w-md w-full bg-white rounded-xl shadow p-6 text-center">
          <h1 className="text-xl font-semibold mb-2 text-gray-900">Invalid payment QR</h1>
          <p className="text-sm text-gray-800">This QR code payload is missing or malformed.</p>
        </div>
      </main>
    )
  }

  const network = String(payload.network || "unknown").toUpperCase()
  const usdTotalAmount = Number(payload.usdTotalAmount ?? payload.totalAmount ?? 0)
  const nativeAmount = Number(payload.nativeAmount ?? 0)
  const nativeSymbol = String(payload.nativeSymbol || "").toUpperCase()
  const quotePriceUsd = Number(payload.quotePriceUsd ?? 0)

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-100">
      <div className="max-w-md w-full bg-white rounded-xl shadow p-6 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">PineTree Payment</h1>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1 text-sm text-gray-900">
          <div><span className="font-semibold">Network:</span> {network}</div>
          <div><span className="font-semibold">Total (USD):</span> {formatUsd(usdTotalAmount)}</div>
          {nativeSymbol ? (
            <div>
              <span className="font-semibold">Pay Amount:</span>{" "}
              {Number.isFinite(nativeAmount) ? nativeAmount : 0} {nativeSymbol}
            </div>
          ) : null}
          {quotePriceUsd > 0 ? (
            <div className="text-xs text-gray-700">Quote: 1 {nativeSymbol} ≈ {formatUsd(quotePriceUsd)}</div>
          ) : null}
          {payload.reference ? (
            <div className="text-xs text-gray-700">
              <span className="font-semibold">Reference:</span> {String(payload.reference).slice(0, 16)}...
            </div>
          ) : null}
        </div>

        {walletOptions.length > 0 ? (
          <div className="space-y-2">
            {walletOptions.map((option) => (
              <a
                key={`${option.label}-${option.href}`}
                href={option.href}
                className={
                  option.tone === "primary"
                    ? "block w-full text-center bg-[#0052FF] text-white rounded-md py-3 font-medium"
                    : "block w-full text-center border border-gray-300 rounded-md py-2 text-sm text-gray-900"
                }
              >
                {option.label}
              </a>
            ))}
          </div>
        ) : (
          <div className="text-sm text-red-700">Could not generate wallet deep link.</div>
        )}

        {walletUrl ? (
          <button
            onClick={copyWalletUrl}
            className="w-full text-center border border-gray-300 rounded-md py-2 text-sm text-gray-900"
          >
            {copied ? "Copied" : "Copy Wallet Link"}
          </button>
        ) : null}

        {payload.redirect ? (
          <a href={payload.redirect} className="block text-center text-sm text-gray-800 underline">
            Return to merchant
          </a>
        ) : null}
      </div>
    </main>
  )
}
