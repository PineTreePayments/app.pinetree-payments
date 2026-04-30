"use client"

import { useCallback, useState } from "react"
import Button from "@/components/ui/Button"

type SolanaAsset = "SOL" | "USDC"

type Props = {
  intentId?: string
  selectedAsset?: SolanaAsset
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  paymentId?: string
  walletOptions?: Array<{ id: string; label: string; url?: string; href?: string }>
  onPaymentCreated?: (paymentId: string) => void
  onError?: (error: string) => void
}

export default function SolanaWalletPayment({
  intentId,
  selectedAsset = "SOL",
  usdAmount,
  nativeAmount,
  paymentId: directPaymentId,
  onPaymentCreated,
  onError,
}: Props) {
  const [isOpening, setIsOpening] = useState(false)
  const [error, setError] = useState("")
  const [resolvedPaymentId, setResolvedPaymentId] = useState<string | null>(
    directPaymentId ?? null
  )

  const getPaymentId = useCallback(async (): Promise<string> => {
    if (resolvedPaymentId) return resolvedPaymentId

    if (!intentId) throw new Error("Missing payment ID")

    const res = await fetch(
      `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "solana", asset: selectedAsset }),
      }
    )

    if (!res.ok) {
      const err = (await res.json()) as { error?: string }
      throw new Error(err.error || "Failed to prepare Solana payment")
    }

    const data = (await res.json()) as { paymentId?: string }
    const id = String(data.paymentId || "").trim()
    if (!id) throw new Error("No payment ID returned")

    setResolvedPaymentId(id)
    onPaymentCreated?.(id)
    return id
  }, [intentId, onPaymentCreated, resolvedPaymentId, selectedAsset])

  const handlePhantomClick = useCallback(async () => {
    setError("")
    setIsOpening(true)
    try {
      const paymentId = await getPaymentId()

      const checkoutUrl = new URL(window.location.href)
      checkoutUrl.searchParams.set("pinetree_payment_id", paymentId)
      checkoutUrl.searchParams.set("wallet", "phantom")
      checkoutUrl.searchParams.set("mode", "wallet-browser")

      window.location.href = `phantom://browse/${encodeURIComponent(checkoutUrl.toString())}`
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open Phantom"
      setError(message)
      onError?.(message)
      setIsOpening(false)
    }
  }, [getPaymentId, onError])

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {intentId ? (
        <>
          <p className="text-lg font-bold text-gray-900">${usdAmount.toFixed(2)} USD</p>
          <p className="text-xs text-gray-500">via Solana · exact SOL determined at payment</p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold text-gray-900">{nativeAmount} SOL</p>
          <p className="text-xs text-gray-500">≈ ${usdAmount.toFixed(2)} USD</p>
        </>
      )}
    </div>
  )

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
        Pay with {selectedAsset} (Solana)
      </div>
      {amountDisplay}

      {error ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          fullWidth
          onClick={() => void handlePhantomClick()}
          disabled={isOpening}
        >
          {isOpening ? "Opening..." : "Phantom"}
        </Button>
        <Button variant="secondary" fullWidth disabled>
          Solflare
        </Button>
      </div>

      <p className="text-xs text-gray-400 text-center">Solflare coming soon</p>
    </div>
  )
}
