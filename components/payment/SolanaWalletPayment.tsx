"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import Button from "@/components/ui/Button"

type SolanaAsset = "SOL" | "USDC"

type WalletOption = {
  id: string
  label: string
  url?: string
  href?: string
}

type SolanaPaymentSession = {
  paymentId: string
  network: "solana"
  asset: SolanaAsset
  paymentUrl: string
  walletOptions: WalletOption[]
}

type Props = {
  intentId?: string
  selectedAsset?: SolanaAsset
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  paymentId?: string
  walletOptions?: WalletOption[]
  onPaymentCreated?: (paymentId: string) => void
  onError?: (error: string) => void
}

function parsePaymentId(paymentUrl: string): string | null {
  try {
    return new URL(paymentUrl).searchParams.get("paymentId")
  } catch {
    return null
  }
}

function normalizeWalletOptions(options?: WalletOption[]): WalletOption[] {
  if (!Array.isArray(options)) return []
  return options.filter((option) => {
    const id = String(option.id || "").toLowerCase().trim()
    return id === "phantom" || id === "solflare"
  })
}

export default function SolanaWalletPayment({
  intentId,
  selectedAsset = "SOL",
  paymentUrl: directPaymentUrl,
  nativeAmount,
  usdAmount,
  paymentId: directPaymentId,
  walletOptions: directWalletOptions,
  onPaymentCreated,
  onError,
}: Props) {
  const [session, setSession] = useState<SolanaPaymentSession | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)
  const [localError, setLocalError] = useState("")
  const sessionRequestRef = useRef<Promise<SolanaPaymentSession> | null>(null)

  const isIntentMode = Boolean(intentId)

  const directSession = useMemo<SolanaPaymentSession | null>(() => {
    if (isIntentMode) return null

    const paymentUrl = String(directPaymentUrl || "").trim()
    const paymentId = directPaymentId || parsePaymentId(paymentUrl) || ""

    if (!paymentUrl || !paymentId) return null

    return {
      paymentId,
      network: "solana",
      asset: selectedAsset,
      paymentUrl,
      walletOptions: normalizeWalletOptions(directWalletOptions),
    }
  }, [directPaymentId, directPaymentUrl, directWalletOptions, isIntentMode, selectedAsset])

  const prepareSession = useCallback(async (): Promise<SolanaPaymentSession> => {
    if (session) return session
    if (directSession) {
      setSession(directSession)
      return directSession
    }

    if (!intentId) {
      throw new Error("Missing Solana payment intent")
    }

    if (selectedAsset !== "SOL") {
      throw new Error("USDC on Solana is coming soon")
    }

    if (sessionRequestRef.current) return sessionRequestRef.current

    const request = (async () => {
      setIsPreparing(true)
      setLocalError("")

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

      const data = (await res.json()) as {
        paymentId?: string
        network?: string
        selectedNetwork?: string
        asset?: string
        paymentUrl?: string
        walletOptions?: WalletOption[]
      }

      const resolvedPaymentId = String(data.paymentId || "")
      const resolvedPaymentUrl = String(data.paymentUrl || "")
      const resolvedNetwork = String(data.network || data.selectedNetwork || "").toLowerCase()
      const resolvedAsset = String(data.asset || selectedAsset).toUpperCase()

      if (resolvedNetwork !== "solana") {
        throw new Error("Server returned a non-Solana payment session")
      }

      if (resolvedAsset !== "SOL") {
        throw new Error("Server returned an unsupported Solana asset")
      }

      if (!resolvedPaymentId || !resolvedPaymentUrl) {
        throw new Error("Incomplete Solana payment session returned from server")
      }

      const resolvedSession: SolanaPaymentSession = {
        paymentId: resolvedPaymentId,
        network: "solana",
        asset: "SOL",
        paymentUrl: resolvedPaymentUrl,
        walletOptions: normalizeWalletOptions(data.walletOptions),
      }

      setSession(resolvedSession)
      onPaymentCreated?.(resolvedPaymentId)

      console.log("SOLANA PAYMENT URL:", resolvedSession.paymentUrl)

      const parsedPaymentUrl = new URL(resolvedSession.paymentUrl)
      const isSolanaTransactionUrl =
        /^\/api\/solana\/tx\/[^/]+$/.test(parsedPaymentUrl.pathname) ||
        (
          parsedPaymentUrl.pathname === "/api/solana-pay/transaction" &&
          parsedPaymentUrl.searchParams.get("paymentId") === resolvedPaymentId
        )

      if (!isSolanaTransactionUrl) {
        throw new Error("Invalid Solana payment URL returned from server")
      }

      return resolvedSession
    })()

    sessionRequestRef.current = request

    try {
      return await request
    } finally {
      sessionRequestRef.current = null
      setIsPreparing(false)
    }
  }, [directSession, intentId, onPaymentCreated, selectedAsset, session])

  const openPaymentUrl = useCallback(
    async (wallet: "phantom" | "solflare") => {
      try {
        const preparedSession = await prepareSession()

        if (wallet === "phantom") {
          window.location.href = `phantom://ul/v1/pay?link=${encodeURIComponent(preparedSession.paymentUrl)}`
          return
        }

        if (wallet === "solflare") {
          window.location.href = `solflare://ul/v1/pay?link=${encodeURIComponent(preparedSession.paymentUrl)}`
          return
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to open Solana payment"
        setLocalError(message)
        onError?.(message)
      }
    },
    [onError, prepareSession]
  )

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {isIntentMode ? (
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

  if (selectedAsset !== "SOL") {
    return (
      <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center">Pay via Solana</div>
        {amountDisplay}
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          USDC on Solana is coming soon. Please select SOL to continue.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center">Pay via Solana</div>
      {amountDisplay}

      {localError ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {localError}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" fullWidth onClick={() => void openPaymentUrl("phantom")} disabled={isPreparing}>
          Phantom
        </Button>
        <Button variant="secondary" fullWidth onClick={() => void openPaymentUrl("solflare")} disabled={isPreparing}>
          Solflare
        </Button>
      </div>
    </div>
  )
}