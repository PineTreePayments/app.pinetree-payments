"use client"

import { useCallback, useMemo, useState } from "react"
import Button from "@/components/ui/Button"

const LIGHTNING_WALLETS = [
  { id: "cash-app",           label: "Cash App" },
  { id: "strike",             label: "Strike" },
  { id: "wallet-of-satoshi",  label: "Wallet of Satoshi" },
  { id: "muun",               label: "Muun" },
  { id: "phoenix",            label: "Phoenix" },
  { id: "zeus",               label: "Zeus" },
  { id: "breez",              label: "Breez" },
  { id: "bluewallet",         label: "BlueWallet" },
  { id: "other",              label: "Other Lightning Wallet" },
] as const

type Props = {
  intentId: string
  usdAmount: number
  paymentStatus?: string
  onPaymentCreated?: () => void
}

type LightningSelectionResult = {
  paymentId?: string
  paymentUrl?: string
  qrCodeUrl?: string
}

function normalizeLightningUri(invoice: string): string {
  const normalized = String(invoice || "").trim()
  if (!normalized) return ""
  return normalized.toLowerCase().startsWith("lightning:")
    ? normalized
    : `lightning:${normalized}`
}

export default function LightningPayment({
  intentId,
  usdAmount,
  paymentStatus,
  onPaymentCreated,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [payment, setPayment] = useState<LightningSelectionResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const invoice = String(payment?.paymentUrl || "")
  const invoiceUri = useMemo(() => normalizeLightningUri(invoice), [invoice])
  const hasInvoice = Boolean(invoiceUri)
  const status = String(paymentStatus || "").toUpperCase()

  const prepareInvoice = useCallback(async () => {
    setLoading(true)
    setError("")
    setCopied(false)

    try {
      const res = await fetch(
        `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network: "bitcoin_lightning", asset: "BTC" }),
        }
      )

      const data = (await res.json()) as LightningSelectionResult & { error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Bitcoin Lightning is unavailable for this merchant")
      }

      setPayment(data)
      onPaymentCreated?.()
    } catch (err) {
      setError((err as Error).message || "Unable to prepare Lightning invoice")
    } finally {
      setLoading(false)
    }
  }, [intentId, onPaymentCreated])

  async function copyInvoice() {
    if (!invoiceUri) return
    await navigator.clipboard.writeText(invoiceUri)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (!hasInvoice) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Pay with Bitcoin Lightning</p>
        <p className="text-xs text-gray-500">Use any compatible Lightning wallet.</p>
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        <Button fullWidth disabled={loading} onClick={() => void prepareInvoice()}>
          {loading
            ? "Preparing invoice..."
            : `Pay with Bitcoin Lightning (${new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(usdAmount)})`}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">Pay with Bitcoin Lightning</p>
        <p className="mt-0.5 text-xs text-gray-500">Choose a Lightning wallet</p>
      </div>

      {/* QR code — desktop only. Hidden on mobile because the QR is on the same
          device that needs to scan it. */}
      {payment?.qrCodeUrl ? (
        <div className="hidden md:flex justify-center rounded-xl border border-gray-200 bg-white p-3">
          <img
            src={payment.qrCodeUrl}
            alt="Bitcoin Lightning invoice QR code"
            className="h-56 w-56"
          />
        </div>
      ) : null}

      {/* Wallet launcher grid — all buttons navigate to the standard lightning: URI.
          The phone OS routes to whichever compatible Lightning app is installed. */}
      <div className="grid grid-cols-2 gap-2">
        {LIGHTNING_WALLETS.map((wallet) => (
          <button
            key={wallet.id}
            onClick={() => { window.location.href = invoiceUri }}
            className={`rounded-xl border border-[#0052FF]/20 bg-white px-3 py-3 text-sm font-medium text-gray-800 shadow-sm transition-all hover:border-[#0052FF]/40 hover:bg-[#0052FF]/5 active:scale-95 ${
              wallet.id === "other" ? "col-span-2" : ""
            }`}
          >
            {wallet.label}
          </button>
        ))}
      </div>

      {status ? (
        <div className="text-center text-xs uppercase tracking-widest text-gray-500">
          {status}
        </div>
      ) : null}

      {/* Copy invoice fallback */}
      <Button variant="secondary" fullWidth onClick={() => void copyInvoice()}>
        {copied ? "Copied" : "Copy Invoice"}
      </Button>

      {/* Collapsed raw invoice — opt-in only */}
      <button
        onClick={() => setShowDetails((v) => !v)}
        className="w-full text-center text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        {showDetails ? "Hide invoice details" : "Show invoice details"}
      </button>

      {showDetails ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-800 break-all">
          {invoiceUri}
        </div>
      ) : null}
    </div>
  )
}
