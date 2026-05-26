"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Button from "@/components/ui/Button"

type PosBaseStep =
  | "awaiting_wallet"
  | "wallet_connected"
  | "payment_sending"
  | "payment_submitted"
  | "confirming"
  | "failed"

type PosBaseSession = {
  controller: "pos_terminal"
  pairingUri?: string
  selectedAsset?: "ETH" | "USDC"
  step?: PosBaseStep
  walletAddressMasked?: string
  txHash?: string
  errorMessage?: string
  updatedAt: number
}

type Props = {
  intentId: string
  selectedAsset: "ETH" | "USDC"
  usdAmount: number
  checkoutToken: string
  onExecutionStarted?: () => void
  onCancel?: () => void
  onPaymentCreated?: () => void
}

const POLL_INTERVAL_MS = 3000

function buildWalletDeepLinks(
  pairingUri: string
): Array<{ id: string; label: string; href: string }> {
  const encoded = encodeURIComponent(pairingUri)
  return [
    { id: "metamask", label: "MetaMask", href: `https://metamask.app.link/wc?uri=${encoded}` },
    { id: "coinbase", label: "Coinbase Wallet", href: `https://go.cb-w.com/wc?uri=${encoded}` },
    { id: "trust", label: "Trust Wallet", href: `https://link.trustwallet.com/wc?uri=${encoded}` },
    { id: "rainbow", label: "Rainbow", href: `rainbow://wc?uri=${encoded}` },
  ]
}

export default function BasePosCheckoutMirror({
  intentId,
  selectedAsset,
  checkoutToken,
  onExecutionStarted,
  onCancel,
  onPaymentCreated,
}: Props) {
  const [session, setSession] = useState<PosBaseSession | null>(null)
  const [selectNetworkError, setSelectNetworkError] = useState("")
  const [paymentReady, setPaymentReady] = useState(false)
  const selectCalledRef = useRef(false)
  const executionStartedRef = useRef(false)

  // Create the payment on mount by calling select-network
  useEffect(() => {
    if (selectCalledRef.current) return
    selectCalledRef.current = true

    const run = async () => {
      try {
        const res = await fetch(
          `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${checkoutToken}`,
            },
            body: JSON.stringify({ network: "base", asset: selectedAsset }),
          }
        )
        if (!res.ok) {
          const err = (await res.json()) as { error?: string }
          throw new Error(err.error || "Failed to prepare Base payment")
        }
        setPaymentReady(true)
        onPaymentCreated?.()
      } catch (err) {
        setSelectNetworkError(
          err instanceof Error ? err.message : "Failed to prepare payment"
        )
      }
    }

    void run()
  }, [intentId, selectedAsset, checkoutToken, onPaymentCreated])

  // Poll the POS session once the payment record exists
  const pollSession = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/pos/base-session/${encodeURIComponent(intentId)}`,
        { cache: "no-store" }
      )
      if (!res.ok) return
      const data = (await res.json()) as { session: PosBaseSession | null }
      if (data.session) {
        setSession(data.session)
      }
    } catch {
      // best-effort polling — ignore transient errors
    }
  }, [intentId])

  useEffect(() => {
    if (!paymentReady) return
    void pollSession()
    const interval = setInterval(() => void pollSession(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [paymentReady, pollSession])

  // Notify parent once the POS starts active execution
  useEffect(() => {
    const step = session?.step
    if (executionStartedRef.current) return
    if (
      step === "wallet_connected" ||
      step === "payment_sending" ||
      step === "payment_submitted" ||
      step === "confirming"
    ) {
      executionStartedRef.current = true
      onExecutionStarted?.()
    }
  }, [session?.step, onExecutionStarted])

  if (selectNetworkError) {
    return (
      <div className="space-y-3">
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {selectNetworkError}
        </div>
        <Button variant="danger" fullWidth onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  if (!paymentReady || !session) {
    return (
      <div className="space-y-4 text-center py-2">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
        <p className="text-sm text-gray-600">Preparing wallet connection…</p>
        <p className="text-xs text-gray-400">The terminal is setting up your payment session.</p>
      </div>
    )
  }

  const { step, pairingUri } = session

  if (!step || step === "awaiting_wallet") {
    if (!pairingUri) {
      return (
        <div className="space-y-4 text-center py-2">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
          <p className="text-sm text-gray-600">Terminal is preparing your wallet connection…</p>
          <Button variant="danger" fullWidth onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )
    }

    const wallets = buildWalletDeepLinks(pairingUri)
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-700 text-center">
          Open your wallet to approve the {selectedAsset} payment.
        </p>
        <div className="space-y-2">
          {wallets.map((wallet) => (
            <a
              key={wallet.id}
              href={wallet.href}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#0052FF]/20 bg-white px-4 py-3 text-sm font-semibold text-gray-900 shadow-sm transition-all hover:border-[#0052FF]/40 hover:bg-[#0052FF]/5"
            >
              {wallet.label}
            </a>
          ))}
        </div>
        <p className="text-xs text-gray-400 text-center">
          Approve the connection request from PineTree Payments in your wallet.
        </p>
        <Button variant="danger" fullWidth onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  if (step === "wallet_connected") {
    return (
      <div className="space-y-4 text-center py-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 mx-auto">
          <span className="text-green-600 text-lg font-bold">✓</span>
        </div>
        <p className="text-sm font-semibold text-gray-900">Wallet connected</p>
        <p className="text-sm text-gray-600">
          Your terminal is processing the {selectedAsset} payment. Please wait.
        </p>
        {session.walletAddressMasked && (
          <p className="text-xs text-gray-400 font-mono">{session.walletAddressMasked}</p>
        )}
      </div>
    )
  }

  if (step === "payment_sending" || step === "payment_submitted") {
    return (
      <div className="space-y-4 text-center py-2">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
        <p className="text-sm font-semibold text-gray-900">
          {step === "payment_sending" ? "Sending payment…" : "Payment submitted"}
        </p>
        <p className="text-sm text-gray-600">
          {step === "payment_sending"
            ? "Please approve the transaction in your wallet."
            : "Transaction submitted — waiting for confirmation."}
        </p>
      </div>
    )
  }

  if (step === "confirming") {
    return (
      <div className="space-y-4 text-center py-2">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
        <p className="text-sm font-semibold text-gray-900">Confirming on-chain…</p>
        <p className="text-sm text-gray-600">
          Your payment is being confirmed. This usually takes a few seconds.
        </p>
      </div>
    )
  }

  if (step === "failed") {
    return (
      <div className="space-y-3">
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {session.errorMessage || "Payment could not be completed. Please try again."}
        </div>
        <Button variant="danger" fullWidth onClick={onCancel}>
          Try Again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 text-center py-2">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
      <p className="text-sm text-gray-600">Processing payment…</p>
    </div>
  )
}
