"use client"

import { useCallback, useState } from "react"
import Button from "@/components/ui/Button"

type SolanaAsset = "SOL" | "USDC"
type SolanaWalletId = "phantom" | "solflare"

type SolanaBrowserProvider = {
  isPhantom?: boolean
  isSolflare?: boolean
  publicKey?: { toString: () => string }
  connect: () => Promise<unknown>
  signAndSendTransaction: (transaction: unknown) => Promise<{ signature: string }>
}

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
  const [openingWallet, setOpeningWallet] = useState<SolanaWalletId | null>(null)
  const [error, setError] = useState("")
  const [resolvedPaymentId, setResolvedPaymentId] = useState<string | null>(
    directPaymentId ?? null
  )

  const getWalletProvider = useCallback((wallet: SolanaWalletId): SolanaBrowserProvider | null => {
    const solanaWindow = getSolanaWindow()
    const phantomProvider =
      solanaWindow.solana?.isPhantom === true
        ? solanaWindow.solana
        : null

    const solflareProvider =
      solanaWindow.solflare?.isSolflare === true
        ? solanaWindow.solflare
        : null

    if (wallet === "phantom") {
      return phantomProvider
    }

    return solflareProvider
  }, [])

  function getSolanaWindow() {
    return window as Window & {
      solana?: SolanaBrowserProvider
      solflare?: SolanaBrowserProvider
    }
  }

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

  const handleWalletClick = useCallback(async (wallet: SolanaWalletId) => {
    setError("")
    setOpeningWallet(wallet)
    try {
      const paymentId = await getPaymentId()
      const provider = getWalletProvider(wallet)

      if (!provider) {
        throw new Error(
          wallet === "phantom"
            ? "Phantom wallet not found. Please install or unlock Phantom."
            : "Solflare wallet not found. Please install or unlock Solflare."
        )
      }

      await provider.connect()

      const walletPublicKey = provider.publicKey?.toString()
      if (!walletPublicKey) {
        throw new Error(`Unable to read ${wallet === "phantom" ? "Phantom" : "Solflare"} wallet public key`)
      }

      const res = await fetch("/api/solana/build-wallet-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, walletPublicKey }),
      })

      const data = (await res.json()) as { transaction?: string; error?: string }

      if (!res.ok || !data?.transaction) {
        throw new Error(data?.error || "Failed to build Solana transaction")
      }

      const { Transaction } = await import("@solana/web3.js")
      const tx = Transaction.from(Buffer.from(data.transaction, "base64"))

      const result = await provider.signAndSendTransaction(tx)

      await fetch(`/api/payments/${encodeURIComponent(paymentId)}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: result.signature }),
      }).catch(() => null)

      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send Solana transaction"
      setError(message)
      onError?.(message)
    } finally {
      setOpeningWallet(null)
    }
  }, [getPaymentId, getWalletProvider, onError])

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {intentId ? (
        <>
          <p className="text-lg font-bold text-gray-900">${usdAmount.toFixed(2)} USD</p>
          <p className="text-xs text-gray-500">via Solana · exact {selectedAsset} determined at payment</p>
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
          onClick={() => void handleWalletClick("phantom")}
          disabled={openingWallet !== null}
        >
          {openingWallet === "phantom" ? "Opening..." : "Pay with Phantom"}
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onClick={() => void handleWalletClick("solflare")}
          disabled={openingWallet !== null}
        >
          {openingWallet === "solflare" ? "Opening..." : "Pay with Solflare"}
        </Button>
      </div>
    </div>
  )
}
