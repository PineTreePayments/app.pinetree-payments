"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Button from "@/components/ui/Button"
import SolanaWalletSelector from "@/components/payment/SolanaWalletSelector"

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
  qrCodeUrl?: string
  paymentId?: string
  walletOptions?: WalletOption[]
  onPaymentCreated?: (paymentId: string) => void
  onError?: (error: string) => void
}

function parsePaymentId(paymentUrl: string): string | null {
  try {
    const txUrl = paymentUrl.replace(/^solana:/, "")
    return new URL(txUrl).searchParams.get("paymentId")
  } catch {
    return null
  }
}

function isSolanaPayTransactionRequest(paymentUrl: string, paymentId: string): boolean {
  if (!paymentUrl.startsWith("solana:")) return false

  try {
    const transactionRequestUrl = new URL(paymentUrl.replace(/^solana:/, ""))
    return (
      transactionRequestUrl.protocol === "https:" &&
      transactionRequestUrl.pathname === "/api/solana-pay/transaction" &&
      transactionRequestUrl.searchParams.get("paymentId") === paymentId
    )
  } catch {
    return false
  }
}

function isSafeSolanaWalletOption(option: WalletOption): boolean {
  const url = String(option.url || option.href || "").trim()
  const id = String(option.id || "").toLowerCase().trim()

  if (!url) return false
  if (url.startsWith("ethereum:")) return false
  if (url.startsWith("metamask:")) return false
  if (url.startsWith("cbwallet:")) return false

  return id === "phantom" || id === "solflare"
}

function normalizeWalletOptions(options?: WalletOption[]): WalletOption[] {
  if (!Array.isArray(options)) return []
  return options.filter(isSafeSolanaWalletOption)
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
  const [isWalletSelectorOpen, setIsWalletSelectorOpen] = useState(false)
  const [hasLaunchedWallet, setHasLaunchedWallet] = useState(false)

  const sessionRequestRef = useRef<Promise<SolanaPaymentSession> | null>(null)
  const isIntentMode = Boolean(intentId)

  const directSession = useMemo<SolanaPaymentSession | null>(() => {
    if (isIntentMode) return null

    const paymentUrl = String(directPaymentUrl || "").trim()
    const paymentId = directPaymentId || parsePaymentId(paymentUrl) || ""

    if (!paymentUrl || !paymentId) return null
    if (!isSolanaPayTransactionRequest(paymentUrl, paymentId)) return null

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

      if (!isSolanaPayTransactionRequest(resolvedPaymentUrl, resolvedPaymentId)) {
        throw new Error("Invalid Solana Pay transaction request URL")
      }

      const walletOptions = normalizeWalletOptions(data.walletOptions)
      if (!walletOptions.length) {
        throw new Error("No supported Solana wallet options were returned")
      }

      const resolvedSession: SolanaPaymentSession = {
        paymentId: resolvedPaymentId,
        network: "solana",
        asset: "SOL",
        paymentUrl: resolvedPaymentUrl,
        walletOptions,
      }

      setSession(resolvedSession)
      onPaymentCreated?.(resolvedPaymentId)
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

  useEffect(() => {
    if (!isIntentMode) {
      if (directSession) setSession(directSession)
      return
    }

    void prepareSession().catch((err) => {
      const message = err instanceof Error ? err.message : "Failed to prepare Solana payment"
      setLocalError(message)
      onError?.(message)
      setIsPreparing(false)
    })
  }, [directSession, isIntentMode, onError, prepareSession])

  const openWalletSelector = useCallback(() => {
    if (!session?.paymentUrl) {
      const message = "Solana payment is not ready yet"
      setLocalError(message)
      onError?.(message)
      return
    }

    setIsWalletSelectorOpen(true)
  }, [onError, session?.paymentUrl])

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

      {isPreparing ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-gray-500 border-t-transparent animate-spin mr-2" />
          Preparing Solana payment…
        </Button>
      ) : null}

      {hasLaunchedWallet ? (
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-gray-900">
            Opening your wallet…
          </p>
          <p className="text-xs text-gray-500">
            Complete the payment in your wallet.
            This screen will update automatically.
          </p>
        </div>
      ) : null}

      {session?.paymentUrl && !hasLaunchedWallet ? (
        <Button fullWidth onClick={openWalletSelector}>
          Pay with Solana Wallet
        </Button>
      ) : null}

      {session?.paymentUrl ? (
        <SolanaWalletSelector
          paymentUrl={session.paymentUrl}
          open={isWalletSelectorOpen}
          onClose={() => setIsWalletSelectorOpen(false)}
          onLaunch={() => {
            setIsWalletSelectorOpen(false)
            setHasLaunchedWallet(true)
          }}
          onError={(message) => {
            setLocalError(message)
            onError?.(message)
          }}
        />
      ) : null}
    </div>
  )
}