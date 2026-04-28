"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useWallet, useConnection } from "@solana/wallet-adapter-react"
import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { Transaction } from "@solana/web3.js"
import Button from "@/components/ui/Button"

type Props = {
  intentId?: string
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  // Kept for compatibility with existing callers; not used in Wallet Adapter flow.
  qrCodeUrl?: string
  paymentId?: string
  onPaymentCreated?: (paymentId: string) => void
  onSuccess?: (txHash: string, paymentId: string) => void
  onError?: (error: string) => void
}

type PaymentData = {
  paymentId: string
  paymentUrl: string
}

function parsePaymentId(paymentUrl: string): string | null {
  try {
    // Handles: solana:https://app.../api/solana-pay/transaction?paymentId=<id>
    const txUrl = paymentUrl.replace(/^solana:/, "")
    return new URL(txUrl).searchParams.get("paymentId")
  } catch {
    return null
  }
}

export default function SolanaWalletPayment({
  intentId,
  paymentUrl: directPaymentUrl,
  nativeAmount,
  usdAmount,
  paymentId: directPaymentId,
  onPaymentCreated,
  onSuccess,
  onError,
}: Props) {
  const { connection } = useConnection()
  const { connected, publicKey, connecting, disconnect, sendTransaction, signTransaction } = useWallet()
  const { setVisible: setWalletModalVisible } = useWalletModal()

  const [isPaying, setIsPaying] = useState(false)
  const [txSignature, setTxSignature] = useState("")
  const [localError, setLocalError] = useState("")
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null)

  const pendingPaymentRef = useRef(false)
  const paymentInFlightRef = useRef(false)
  const paymentResolutionInFlightRef = useRef<Promise<PaymentData> | null>(null)

  const isIntentMode = Boolean(intentId)

  const resolveSolanaPayment = useCallback(async (): Promise<PaymentData> => {
    if (paymentData?.paymentId && paymentData.paymentUrl) {
      return paymentData
    }

    if (!isIntentMode) {
      const paymentId = directPaymentId || parsePaymentId(directPaymentUrl || "") || ""
      const paymentUrl = String(directPaymentUrl || "")

      if (!paymentId) throw new Error("Cannot determine paymentId")
      if (!paymentUrl) throw new Error("Missing Solana payment URL")

      const directPaymentData = { paymentId, paymentUrl }
      setPaymentData(directPaymentData)
      return directPaymentData
    }

    if (paymentResolutionInFlightRef.current) {
      return paymentResolutionInFlightRef.current
    }

    const resolution = (async () => {
      const createRes = await fetch(
        `/api/payment-intents/${encodeURIComponent(intentId!)}/select-network`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network: "solana" }),
        }
      )

      if (!createRes.ok) {
        const err = (await createRes.json()) as { error?: string }
        throw new Error(err.error || "Failed to create payment")
      }

      const createResult = (await createRes.json()) as {
        paymentId?: string
        paymentUrl?: string
      }
      const resolvedPaymentId = String(createResult.paymentId || "")
      const resolvedPaymentUrl = String(createResult.paymentUrl || "")

      if (!resolvedPaymentId || !resolvedPaymentUrl) {
        throw new Error("Incomplete payment data returned from server")
      }

      const resolvedPaymentData = {
        paymentId: resolvedPaymentId,
        paymentUrl: resolvedPaymentUrl,
      }

      setPaymentData(resolvedPaymentData)
      onPaymentCreated?.(resolvedPaymentId)

      return resolvedPaymentData
    })()

    paymentResolutionInFlightRef.current = resolution

    try {
      return await resolution
    } finally {
      paymentResolutionInFlightRef.current = null
    }
  }, [
    paymentData,
    isIntentMode,
    directPaymentId,
    directPaymentUrl,
    intentId,
    onPaymentCreated,
  ])

  const handlePay = useCallback(async () => {
    if (!publicKey || paymentInFlightRef.current || txSignature) return

    pendingPaymentRef.current = false
    paymentInFlightRef.current = true
    setIsPaying(true)
    setLocalError("")

    try {
      const { paymentId: resolvedPaymentId } = await resolveSolanaPayment()

      // Build transaction from backend
      const txRes = await fetch(
        `/api/solana-pay/transaction?paymentId=${encodeURIComponent(resolvedPaymentId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: publicKey.toBase58() }),
        }
      )
      if (!txRes.ok) {
        const err = (await txRes.json()) as { error?: string }
        throw new Error(err.error || "Failed to build transaction")
      }
      const { transaction: serialized } = (await txRes.json()) as { transaction: string }

      const txBytes = Uint8Array.from(atob(serialized), (c) => c.charCodeAt(0))
      const tx = Transaction.from(txBytes)

      // Step 3: sign in wallet, then send through adapter
      if (!signTransaction) {
        throw new Error("Connected wallet does not support transaction signing")
      }
      const signedTx = await signTransaction(tx)
      const signature = await sendTransaction(signedTx, connection)
      console.log("[SOLANA] wallet adapter tx submitted", { signature })

      setTxSignature(signature)
      onSuccess?.(signature, resolvedPaymentId)
    } catch (err) {
      const msg = (err as Error)?.message || "Transaction failed"
      const friendly =
        msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("user rejected")
          ? "Transaction rejected by user."
          : msg
      setLocalError(friendly)
      onError?.(friendly)
    } finally {
      paymentInFlightRef.current = false
      setIsPaying(false)
    }
  }, [
    resolveSolanaPayment,
    publicKey,
    signTransaction,
    sendTransaction,
    connection,
    txSignature,
    onSuccess,
    onError,
  ])

  useEffect(() => {
    if (connected && publicKey && pendingPaymentRef.current) {
      pendingPaymentRef.current = false
      void handlePay()
    }
  }, [connected, publicKey, handlePay])

  const handleOpenWithWalletClick = useCallback(async () => {
    if (paymentInFlightRef.current || txSignature) return

    setLocalError("")

    try {
      const { paymentUrl: resolvedPaymentUrl } = await resolveSolanaPayment()

      if (!resolvedPaymentUrl.startsWith("solana:")) {
        throw new Error("Invalid Solana Pay link")
      }

      console.log("[SOLANA] deep link open", { url: resolvedPaymentUrl })
      window.location.href = resolvedPaymentUrl
    } catch (err) {
      const msg = (err as Error)?.message || "Unable to open wallet"
      setLocalError(msg)
      onError?.(msg)
    }
  }, [resolveSolanaPayment, txSignature, onError])

  const handleChooseWalletClick = useCallback(() => {
    if (paymentInFlightRef.current || txSignature) return

    setLocalError("")

    if (!connected || !publicKey) {
      pendingPaymentRef.current = true
      setWalletModalVisible(true)
      return
    }

    void handlePay()
  }, [connected, publicKey, setWalletModalVisible, handlePay, txSignature])

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

  if (txSignature) {
    return (
      <div className="space-y-3 text-center py-2">
        <div className="flex justify-center">
          <svg
            className="w-12 h-12 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-900">Transaction submitted</p>
        <p className="text-xs text-gray-500">Processing payment...</p>
        <a
          href={`https://solscan.io/tx/${txSignature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 underline break-all block"
        >
          View on Solscan ↗
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center">Pay via Solana</div>
      {amountDisplay}

      {connected && publicKey ? (
        <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 break-all font-mono">
          {publicKey.toBase58()}
        </div>
      ) : null}

      {localError ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {localError}
        </div>
      ) : null}

      <Button fullWidth disabled={isPaying} onClick={() => void handleOpenWithWalletClick()}>
        Open with your wallet
      </Button>

      {isPaying ? (
        <Button variant="secondary" fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-gray-500 border-t-transparent animate-spin mr-2" />
          Approve in your wallet
        </Button>
      ) : (
        <Button variant="secondary" fullWidth disabled={connecting} onClick={handleChooseWalletClick}>
          {connecting ? "Connecting wallet..." : "Choose a wallet"}
        </Button>
      )}

      {connected ? (
        <Button variant="secondary" fullWidth disabled={connecting} onClick={() => void disconnect()}>
          Disconnect
        </Button>
      ) : null}
    </div>
  )
}
