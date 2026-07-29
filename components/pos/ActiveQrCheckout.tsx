"use client"

import Image from "next/image"
import { Clock3 } from "lucide-react"
import Button from "@/components/ui/Button"

type Breakdown = {
  subtotalAmount: number
  taxAmount: number
  taxEnabled: boolean
  taxRate: number
  serviceFee: number
  totalAmount: number
}

type Props = {
  qrCodeUrl: string
  breakdown: Breakdown | null
  canceling: boolean
  onCancel: () => void
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0
  )
}

export default function ActiveQrCheckout({
  qrCodeUrl,
  breakdown,
  canceling,
  onCancel,
}: Props) {
  return (
    <div className="w-full space-y-3" data-active-qr-checkout-flow="true">
      {qrCodeUrl ? (
        <div
          className="flex flex-col items-center rounded-2xl border border-[#DDEBFF] bg-[#F7FAFF] px-4 py-4 text-center"
          data-active-qr-section="true"
        >
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0052FF]">
            SCAN TO PAY
          </p>
          <Image
            src={qrCodeUrl}
            width={216}
            height={216}
            alt="QR code"
            className="h-auto w-full max-w-[216px] rounded-xl"
          />
          <div
            className="mt-3 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600"
            data-active-qr-waiting-indicator="true"
            aria-hidden="true"
          >
            <Clock3 size={17} strokeWidth={1.8} />
          </div>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-600">
            WAITING
          </p>
        </div>
      ) : (
        <div
          className="rounded-2xl border border-[#DDEBFF] bg-[#F7FAFF] px-4 py-6 text-center"
          data-active-qr-section="true"
        >
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
            Preparing payment…
          </p>
        </div>
      )}

      {breakdown && (
        <div
          className="space-y-1.5 rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm"
          data-active-qr-totals-section="true"
        >
          <div className="flex justify-between text-gray-700">
            <span>Subtotal</span>
            <span>{fmtUsd(breakdown.subtotalAmount)}</span>
          </div>
          {breakdown.taxEnabled && (
            <div className="flex justify-between text-gray-700">
              <span>Tax ({breakdown.taxRate}%)</span>
              <span>{fmtUsd(breakdown.taxAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-700">
            <span>Service fee</span>
            <span>{fmtUsd(breakdown.serviceFee)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900">
            <span>Total</span>
            <span>{fmtUsd(breakdown.totalAmount)}</span>
          </div>
        </div>
      )}

      <Button variant="danger" fullWidth disabled={canceling} onClick={onCancel}>
        {canceling ? "Canceling…" : "Cancel Payment"}
      </Button>
    </div>
  )
}
