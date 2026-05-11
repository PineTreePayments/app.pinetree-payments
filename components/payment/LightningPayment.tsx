"use client"

import { useCallback, useMemo, useState } from "react"
import Button from "@/components/ui/Button"

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
  onPaymentCreated
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [payment, setPayment] = useState<LightningSelectionResult | null>(null)

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
        <p className="text-sm text-gray-700 font-medium">
          Pay with Bitcoin Lightning
        </p>
        <p className="text-xs text-gray-500">
          Use any compatible Lightning wallet.
        </p>
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        <Button fullWidth disabled={loading} onClick={() => void prepareInvoice()}>
          {loading ? "Preparing invoice..." : `Pay with Bitcoin Lightning (${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(usdAmount)})`}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 text-center">
        Scan or copy the invoice and pay with any compatible Lightning wallet.
      </p>
      {payment?.qrCodeUrl ? (
        <div className="flex justify-center rounded-xl border border-gray-200 bg-white p-3">
          <img src={payment.qrCodeUrl} alt="Bitcoin Lightning invoice QR code" className="h-56 w-56" />
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-800 break-all">
        {invoiceUri}
      </div>

      {status ? (
        <div className="text-center text-xs uppercase tracking-widest text-gray-500">
          {status}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => void copyInvoice()}>
          {copied ? "Copied" : "Copy Invoice"}
        </Button>
        <Button onClick={() => { window.location.href = invoiceUri }}>
          Open Wallet
        </Button>
      </div>
    </div>
  )
}
