"use client"

import { useState } from "react"
import QRCode from "react-qr-code"
import Button from "@/components/ui/Button"

type Props = {
  paymentUrl: string
  open: boolean
  onClose: () => void
  onLaunch?: () => void
  onError?: (error: string) => void
}

export default function SolanaWalletSelector({
  paymentUrl,
  open,
  onClose,
  onLaunch,
  onError,
}: Props) {
  const [copied, setCopied] = useState(false)

  if (!open) return null

  function launchSolanaWallet() {
    if (!paymentUrl) {
      onError?.("Missing wallet link")
      return
    }
    onLaunch?.()
    window.location.href = `solana:${paymentUrl}`
  }

  async function copyPaymentLink() {
    try {
      await navigator.clipboard.writeText(paymentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      onError?.("Unable to copy payment link")
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="solana-wallet-selector-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 id="solana-wallet-selector-title" className="text-lg font-bold text-gray-900">
            Pay with Solana
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
            aria-label="Close wallet selector"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">
            Your device will open the Solana wallet registered for Solana Pay links.
            To use a specific wallet, open that wallet and scan the QR below.
          </p>

          <Button fullWidth onClick={launchSolanaWallet}>
            Open Solana Wallet
          </Button>

          <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs text-gray-500">Scan from inside your wallet</p>
            <QRCode value={`solana:${paymentUrl}`} size={180} />
          </div>

          <Button fullWidth variant="secondary" onClick={copyPaymentLink}>
            {copied ? "Payment Link Copied" : "Copy payment link"}
          </Button>
        </div>
      </div>
    </div>
  )
}
