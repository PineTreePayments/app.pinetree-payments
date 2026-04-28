"use client"

import { useMemo, useState } from "react"
import Button from "@/components/ui/Button"

type Props = {
  paymentUrl: string
  open: boolean
  onClose: () => void
  onLaunch?: () => void
  onError?: (error: string) => void
}

type WalletOption = {
  id: string
  label: string
  url: string
}

function buildSupportedWalletOptions(paymentUrl: string): WalletOption[] {
  const encodedPaymentUrl = encodeURIComponent(paymentUrl)

  return [
    {
      id: "phantom",
      label: "Phantom",
      url: `https://phantom.app/ul/browse/${encodedPaymentUrl}`,
    },
    {
      id: "solflare",
      label: "Solflare",
      url: `https://solflare.com/ul/v1/browse/${encodedPaymentUrl}`,
    },
  ]
}

export default function SolanaWalletSelector({
  paymentUrl,
  open,
  onClose,
  onLaunch,
  onError,
}: Props) {
  const [copied, setCopied] = useState(false)
  const walletOptions = useMemo(() => buildSupportedWalletOptions(paymentUrl), [paymentUrl])

  if (!open) return null

  function launch(url: string) {
    if (!url) {
      const message = "Missing wallet link"
      onError?.(message)
      return
    }

    onLaunch?.()
    window.location.href = url
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
            Choose your wallet
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

        <div className="p-4 space-y-2">
          {walletOptions.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              onClick={() => launch(wallet.url)}
              className="w-full flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left hover:bg-gray-50 active:scale-[0.99] transition"
            >
              <span className="font-semibold text-gray-900">{wallet.label}</span>
              <span className="text-xs text-gray-400">Open</span>
            </button>
          ))}

          <div className="py-2">
            <div className="h-px bg-gray-200" />
          </div>

          <Button fullWidth variant="secondary" onClick={() => launch(paymentUrl)}>
            Open with installed wallet
          </Button>

          <Button fullWidth variant="secondary" onClick={copyPaymentLink}>
            {copied ? "Payment Link Copied" : "Copy payment link"}
          </Button>
        </div>
      </div>
    </div>
  )
}