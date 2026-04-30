"use client"

import { useCallback, useMemo, useState } from "react"
import { useAccount, useConnect, useSwitchChain } from "wagmi"
import type { Connector } from "wagmi"
import { base } from "wagmi/chains"
import Button from "@/components/ui/Button"

type BaseAsset = "ETH" | "USDC"

type Props = {
  intentId?: string
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  paymentId?: string
  selectedAsset?: BaseAsset
  onPaymentCreated?: (paymentId: string) => void
  onSuccess?: (txHash: string, paymentId: string) => void | Promise<void>
  onError?: (error: string) => void
}

type PaymentData = {
  paymentId: string
  paymentUrl: string
}

type EvmTransactionRequest = {
  to: string
  value: string
  data: string
  chainId: number
}

function isEip1193Error(error: unknown): error is { code?: number; message?: string } {
  return typeof error === "object" && error !== null
}

function isEip1193Provider(value: unknown): value is Eip1193Provider {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { request?: unknown }).request === "function"
  )
}

function connectorMetadata(connector: Connector) {
  return {
    id: connector.id,
    name: connector.name,
    type: connector.type,
  }
}

function connectorText(connector: Connector): string {
  return `${connector.id} ${connector.name} ${connector.type}`.toLowerCase()
}

function isWalletConnectConnector(connector: Connector): boolean {
  const text = connectorText(connector)
  return text.includes("walletconnect") || text.includes("wallet connect")
}

function decimalOrHexToHex(value: string): string {
  const normalized = String(value || "0").trim()
  if (!normalized) return "0x0"
  if (normalized.startsWith("0x")) return `0x${BigInt(normalized).toString(16)}`
  return `0x${BigInt(normalized).toString(16)}`
}

function parseEthereumPaymentUri(paymentUrl: string): EvmTransactionRequest {
  const raw = String(paymentUrl || "").trim()
  if (!raw.startsWith("ethereum:")) {
    throw new Error("Invalid Base payment transaction returned by server")
  }

  const withoutScheme = raw.slice("ethereum:".length)
  const [target, query = ""] = withoutScheme.split("?")
  const [contractAddress, chainIdRaw = ""] = target.split("@")
  const chainId = Number(chainIdRaw || 0)
  const params = new URLSearchParams(query)
  const data = String(params.get("data") || "").trim()
  const value = String(params.get("value") || "0").trim()

  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    throw new Error("Invalid Base split contract address returned by server")
  }

  if (chainId !== base.id) {
    throw new Error("Payment is not configured for Base mainnet")
  }

  if (!/^0x[a-fA-F0-9]*$/.test(data)) {
    throw new Error("Invalid Base transaction calldata returned by server")
  }

  return {
    to: contractAddress,
    chainId,
    value: decimalOrHexToHex(value),
    data,
  }
}

async function getWalletConnectProvider(connector: Connector): Promise<Eip1193Provider> {
  if (!("getProvider" in connector) || typeof connector.getProvider !== "function") {
    throw new Error("WalletConnect provider is unavailable. Please try again.")
  }

  const provider = await connector.getProvider()
  if (!isEip1193Provider(provider)) {
    throw new Error("WalletConnect provider is unavailable. Please try again.")
  }

  return provider
}

async function ensureBaseChain(provider: Eip1193Provider): Promise<void> {
  const chainId = await provider.request({ method: "eth_chainId" })
  if (String(chainId).toLowerCase() === `0x${base.id.toString(16)}`) return

  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${base.id.toString(16)}` }],
  })
}

async function getConnectedEvmAddress(provider: Eip1193Provider): Promise<string> {
  const accounts = await provider.request({ method: "eth_requestAccounts" })
  const firstAccount = Array.isArray(accounts) ? String(accounts[0] || "").trim() : ""

  if (!/^0x[a-fA-F0-9]{40}$/.test(firstAccount)) {
    throw new Error("Unable to read connected Base wallet address")
  }

  return firstAccount
}

function extractAddressFromConnectResult(result: unknown): string {
  if (!result || typeof result !== "object") return ""

  const source = result as {
    accounts?: readonly string[]
    account?: string
    addresses?: readonly string[]
  }

  return String(source.accounts?.[0] || source.account || source.addresses?.[0] || "").trim()
}

export default function BaseWalletPayment({
  intentId,
  paymentUrl: directPaymentUrl,
  nativeAmount,
  usdAmount,
  paymentId: directPaymentId,
  selectedAsset = "ETH",
  onPaymentCreated,
  onSuccess,
  onError,
}: Props) {
  console.log("[BaseWalletPayment] rendered")

  const { address, chain, isConnected } = useAccount()
  const { connectors, connectAsync, status: connectStatus } = useConnect()
  const { switchChainAsync, status: switchStatus } = useSwitchChain()

  const [localError, setLocalError] = useState("")
  const [isPreparingPayment, setIsPreparingPayment] = useState(false)
  const [isOpeningWallet, setIsOpeningWallet] = useState(false)

  const isIntentMode = Boolean(intentId)
  const isOnBase = chain?.id === base.id
  const isConnecting = connectStatus === "pending" || switchStatus === "pending"
  const isUsdcDeferred = selectedAsset === "USDC"

  const walletConnectConnector = useMemo(
    () => connectors.find(isWalletConnectConnector) || null,
    [connectors]
  )

  console.log("[Base] available connectors", connectors.map(connectorMetadata))

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
          body: JSON.stringify({ network: "base", asset: selectedAsset }),
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
  }, [directPaymentId, directPaymentUrl, intentId, isIntentMode, onPaymentCreated, selectedAsset])

  const handlePayClick = useCallback(() => {
    setLocalError("")

    void (async () => {
      let createdPaymentId = ""
      let fromAddress = String(address || "").trim()

      try {
        if (selectedAsset !== "ETH") {
          throw new Error("USDC on Base is coming soon. Please choose ETH on Base for now.")
        }

        if (!walletConnectConnector) {
          throw new Error("WalletConnect is not configured.")
        }

        console.log("[Base] WalletConnect selected")

        if (!isConnected || !fromAddress) {
          const result = await connectAsync({ connector: walletConnectConnector, chainId: base.id })
          fromAddress = extractAddressFromConnectResult(result) || fromAddress
          console.log("[Base] WalletConnect connected", { hasAddress: Boolean(fromAddress) })
        }

        if (!fromAddress) {
          throw new Error("Wallet connected, but no wallet address was returned.")
        }

        if (!isOnBase) {
          try {
            await switchChainAsync({ chainId: base.id })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (!message.toLowerCase().includes("already") && !message.includes(String(base.id))) {
              throw error
            }
          }
        }

        const paymentData = await resolvePaymentData()
        createdPaymentId = paymentData.paymentId
        const txRequest = parseEthereumPaymentUri(paymentData.paymentUrl)
        const provider = await getWalletConnectProvider(walletConnectConnector)
        await ensureBaseChain(provider)
        fromAddress = fromAddress || await getConnectedEvmAddress(provider)

        setIsOpeningWallet(true)
        console.log("[Base] Sending Base transaction")

        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: fromAddress,
            to: txRequest.to,
            value: txRequest.value,
            data: txRequest.data,
          }],
        })

        const normalizedTxHash = String(txHash || "").trim()
        if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)) {
          throw new Error("Wallet did not return a transaction hash")
        }

        console.log("[Base] Base tx submitted", { txHash: normalizedTxHash })

        await onSuccess?.(normalizedTxHash, paymentData.paymentId)

        if (intentId) {
          window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to open Base payment"
        const rejected =
          message.toLowerCase().includes("rejected") ||
          (isEip1193Error(err) && err.code === 4001)
        const friendly = rejected
          ? "Wallet connection rejected by user."
          : message

        if (rejected && createdPaymentId) {
          await fetch(`/api/payments/${encodeURIComponent(createdPaymentId)}/fail`, {
            method: "POST",
          }).catch(() => null)

          if (intentId) {
            window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=cancelled`
            return
          }
        }

        setLocalError(friendly)
        setIsPreparingPayment(false)
        setIsOpeningWallet(false)
        onError?.(friendly)
      }
    })()
  }, [address, connectAsync, intentId, isConnected, isOnBase, onError, onSuccess, resolvePaymentData, selectedAsset, switchChainAsync, walletConnectConnector])

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {isIntentMode ? (
        <>
          <p className="text-lg font-bold text-gray-900">${usdAmount.toFixed(2)} USD</p>
          <p className="text-xs text-gray-500">via Base Network · exact {selectedAsset} determined at payment</p>
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

      {isUsdcDeferred ? (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          USDC on Base is coming soon. Please choose ETH on Base for now.
        </div>
      ) : null}

      {isUsdcDeferred ? (
        <Button fullWidth disabled>
          USDC on Base coming soon
        </Button>
      ) : isConnecting ? (
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
        <div className="space-y-2">
          {walletConnectConnector ? (
            <Button fullWidth onClick={() => handlePayClick()}>
              Pay with WalletConnect
            </Button>
          ) : (
            <div className="text-[11px] text-gray-500 text-center">
              WalletConnect is not configured.
            </div>
          )}
        </div>
      )}
    </div>
  )
}