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
  redirect?: string
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

function buildWalletUrl(payload: SplitPayload, rawData: string) {
  const network = String(payload.network || "").toLowerCase()
  const recipient = String(payload.outputs?.[0]?.address || "")
  const totalAmount = Number(payload.totalAmount || 0)
  const reference = String(payload.reference || "")

  if (!recipient) return ""

  if (network === "solana") {
    const query = new URLSearchParams()
    if (Number.isFinite(totalAmount) && totalAmount > 0) query.set("amount", String(totalAmount))
    if (reference) query.set("reference", reference)
    query.set("label", "PineTree Payment")
    query.set("message", reference ? `Payment #${reference.slice(0, 8)}` : "PineTree Payment")

    const qs = query.toString()
    return qs ? `solana:${recipient}?${qs}` : `solana:${recipient}`
  }

  if (network === "base" || network === "base_pay" || network === "ethereum") {
    const chainId = network === "ethereum" ? "1" : "8453"
    return `ethereum:${recipient}@${chainId}/transfer?address=${recipient}&uint256=${totalAmount}`
  }

  return `pinetree://pay?data=${encodeURIComponent(rawData)}`
}

export default function PayPage() {
  const searchParams = useSearchParams()
  const rawData = searchParams.get("data")
  const [copied, setCopied] = useState(false)

  const payload = useMemo(() => parsePayload(rawData), [rawData])
  const walletUrl = useMemo(
    () => (rawData && payload ? buildWalletUrl(payload, rawData) : ""),
    [payload, rawData]
  )

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
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-xl shadow p-6 text-center">
          <h1 className="text-xl font-semibold mb-2">Invalid payment QR</h1>
          <p className="text-sm text-gray-600">This QR code payload is missing or malformed.</p>
        </div>
      </main>
    )
  }

  const network = String(payload.network || "unknown").toUpperCase()
  const totalAmount = Number(payload.totalAmount || 0)

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-xl shadow p-6 space-y-4">
        <h1 className="text-xl font-semibold">PineTree Payment</h1>

        <div className="text-sm text-gray-700 space-y-1">
          <div><span className="font-medium">Network:</span> {network}</div>
          <div><span className="font-medium">Amount:</span> {Number.isFinite(totalAmount) ? totalAmount : 0}</div>
          {payload.reference ? (
            <div><span className="font-medium">Reference:</span> {String(payload.reference).slice(0, 12)}...</div>
          ) : null}
        </div>

        {walletUrl ? (
          <a
            href={walletUrl}
            className="block w-full text-center bg-[#0052FF] text-white rounded-md py-3 font-medium"
          >
            Open Wallet
          </a>
        ) : (
          <div className="text-sm text-red-600">Could not generate wallet deep link.</div>
        )}

        {walletUrl ? (
          <button
            onClick={copyWalletUrl}
            className="w-full text-center border border-gray-300 rounded-md py-2 text-sm"
          >
            {copied ? "Copied" : "Copy Wallet Link"}
          </button>
        ) : null}

        {payload.redirect ? (
          <a href={payload.redirect} className="block text-center text-sm text-gray-500 underline">
            Return to merchant
          </a>
        ) : null}
      </div>
    </main>
  )
}
