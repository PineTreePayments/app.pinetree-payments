"use client"

import { useCallback, useState } from "react"
import { useAccount, useConnect, useSwitchChain } from "wagmi"
import { base } from "wagmi/chains"
import Button from "@/components/ui/Button"

type Props = {
  intentId?: string
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  paymentId?: string
  onPaymentCreated?: (paymentId: string) => void
  onSuccess?: (txHash: string, paymentId: string) => void
  onError?: (error: string) => void
}

type PaymentData = {
  paymentId: string
  paymentUrl: string
}

export default function BaseWalletPayment({
  intentId,
  paymentUrl: directPaymentUrl,
  nativeAmount,
  usdAmount,
  paymentId: directPaymentId,
  onPaymentCreated,
  onError,
}: Props) {
  const { address, chain, isConnected } = useAccount()
  const { connectors, connectAsync, status: connectStatus } = useConnect()
  const { switchChainAsync, status: switchStatus } = useSwitchChain()

  const [localError, setLocalError] = useState("")
  const [isPreparingPayment, setIsPreparingPayment] = useState(false)
  const [isOpeningWallet, setIsOpeningWallet] = useState(false)

  const isIntentMode = Boolean(intentId)
  const isOnBase = chain?.id === base.id
  const isConnecting = connectStatus === "pending" || switchStatus === "pending"

  console.log("BASE CONNECTORS:", connectors)

  const resolvePaymentData = useCallback(async (): Promise<PaymentData> => {
    if (!isIntentMode) {
      const paymentUrl = String(directPaymentUrl || "").trim()
      const paymentId = String(directPaymentId || "").trim()

      if (!paymentUrl) {
        throw new Error("Payment details unavailable — please contact support.")
      }

      return { paymentId, paymentUrl }
    }

    if (!intentId) {
      throw new Error("Missing Base payment intent")
    }

    setIsPreparingPayment(true)

    try {
      const res = await fetch(
        `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network: "base" }),
        }
      )

      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error || "Failed to prepare Base payment")
      }

      const result = (await res.json()) as { paymentId?: string; paymentUrl?: string }
      const paymentId = String(result.paymentId || "").trim()
      const paymentUrl = String(result.paymentUrl || "").trim()

      if (!paymentId || !paymentUrl) {
        throw new Error("Incomplete payment data returned from server")
      }

      onPaymentCreated?.(paymentId)

      console.log("BASE PAYMENT URL:", paymentUrl)

      return { paymentId, paymentUrl }
    } finally {
      setIsPreparingPayment(false)
    }
  }, [directPaymentId, directPaymentUrl, intentId, isIntentMode, onPaymentCreated])

  const handlePayClick = useCallback(() => {
    setLocalError("")

    void (async () => {
      try {
        if (isConnected) {
          if (!isOnBase) {
            await switchChainAsync({ chainId: base.id })
          }
        } else {
          const connector = connectors[0]

          if (!connector) {
            throw new Error("No wallet found. Install Coinbase Wallet, MetaMask, or Trust Wallet.")
          }

          console.log("BASE CONNECTING...")
          await connectAsync({ connector, chainId: base.id })
        }

        const paymentData = await resolvePaymentData()

        setIsOpeningWallet(true)
        window.location.href = paymentData.paymentUrl
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to open Base payment"
        const friendly = message.toLowerCase().includes("rejected")
          ? "Wallet connection rejected by user."
          : message

        setLocalError(friendly)
        setIsPreparingPayment(false)
        setIsOpeningWallet(false)
        onError?.(friendly)
      }
    })()
  }, [connectAsync, connectors, isConnected, isOnBase, onError, resolvePaymentData, switchChainAsync])

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {isIntentMode ? (
        <>
          <p className="text-lg font-bold text-gray-900">${usdAmount.toFixed(2)} USD</p>
          <p className="text-xs text-gray-500">via Base Network · exact ETH determined at payment</p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold text-gray-900">{nativeAmount} ETH</p>
          <p className="text-xs text-gray-500">≈ ${usdAmount.toFixed(2)} USD</p>
        </>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
        Pay via Base Network
      </div>

      {amountDisplay}

      {address ? (
        <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 break-all font-mono">
          {address}
        </div>
      ) : null}

      {localError ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {localError}
        </div>
      ) : null}

      {isConnecting ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          Connecting…
        </Button>
      ) : isPreparingPayment ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          Preparing payment…
        </Button>
      ) : isOpeningWallet ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          Opening wallet…
        </Button>
      ) : (
        <Button fullWidth onClick={handlePayClick}>
          Pay with ETH
        </Button>
      )}
    </div>
  )
}