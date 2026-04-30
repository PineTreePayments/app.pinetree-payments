"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAccount, useConnect, useSwitchChain } from "wagmi"
import type { Connector } from "wagmi"
import { base } from "wagmi/chains"
import { decodeFunctionData, encodeFunctionData } from "viem"
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

type WalletConnectProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

const BASE_WC_PENDING_KEY = "pinetree_base_wc_pending"
const BASE_WC_PENDING_TTL_MS = 10 * 60 * 1000
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const

const SPLIT_TOKEN_ABI = [
  {
    type: "function",
    name: "splitToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "treasury", type: "address" },
      { name: "merchantAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
      { name: "paymentRef", type: "string" },
      { name: "token", type: "address" },
    ],
    outputs: [],
  },
] as const

type PendingBaseWalletConnectPayment = {
  intentId: string | null
  selectedAsset: BaseAsset
  createdAt: number
}

function isEip1193Error(error: unknown): error is { code?: number; message?: string } {
  return typeof error === "object" && error !== null
}

async function logBase(stage: string, payload: Record<string, unknown> = {}): Promise<void> {
  console.log("[BASE DEBUG]", stage, payload)
  await fetch("/api/debug/base", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage, payload }),
  }).catch(() => null)
}

function isRejectedError(error: unknown, message: string): boolean {
  return (
    message.toLowerCase().includes("rejected") ||
    message.toLowerCase().includes("reject") ||
    message.toLowerCase().includes("cancel") ||
    (isEip1193Error(error) && error.code === 4001)
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

function isWalletConnectProvider(provider: unknown): provider is WalletConnectProvider {
  return (
    typeof provider === "object" &&
    provider !== null &&
    typeof (provider as { request?: unknown }).request === "function"
  )
}

async function getWalletConnectProvider(connector: Connector): Promise<WalletConnectProvider> {
  const provider = await connector.getProvider()
  if (!isWalletConnectProvider(provider)) {
    throw new Error("WalletConnect provider is not available.")
  }
  return provider
}

function normalizeHexTransactionHash(value: unknown): string {
  const txHash = String(value || "").trim()
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new Error("Wallet did not return a transaction hash")
  }
  return txHash
}

async function sendWalletConnectTransaction(input: {
  provider: WalletConnectProvider
  fromAddress: string
  txRequest: EvmTransactionRequest
}): Promise<string> {
  const txHash = await input.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: input.fromAddress,
        to: input.txRequest.to,
        value: input.txRequest.value,
        data: input.txRequest.data,
        chainId: decimalOrHexToHex(String(input.txRequest.chainId)),
      },
    ],
  })

  return normalizeHexTransactionHash(txHash)
}

function buildBaseUsdcApprovalTransaction(txRequest: EvmTransactionRequest): EvmTransactionRequest {
  const decoded = decodeFunctionData({
    abi: SPLIT_TOKEN_ABI,
    data: txRequest.data as `0x${string}`,
  })

  if (decoded.functionName !== "splitToken") {
    throw new Error("Invalid Base USDC split transaction returned by server")
  }

  const [, , merchantAmount, feeAmount, , token] = decoded.args
  const tokenAddress = String(token || "").trim().toLowerCase()
  if (tokenAddress !== BASE_USDC_ADDRESS.toLowerCase()) {
    throw new Error("Base USDC payment returned an unexpected token address")
  }

  const approvalAmount = merchantAmount + feeAmount
  if (approvalAmount <= BigInt(0)) {
    throw new Error("Invalid Base USDC approval amount")
  }

  return {
    to: BASE_USDC_ADDRESS,
    chainId: base.id,
    value: "0x0",
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [txRequest.to as `0x${string}`, approvalAmount],
    }),
  }
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

function getPendingBaseWalletConnectPayment(): PendingBaseWalletConnectPayment | null {
  try {
    const raw = sessionStorage.getItem(BASE_WC_PENDING_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<PendingBaseWalletConnectPayment>
    const selectedAsset = parsed.selectedAsset === "ETH" || parsed.selectedAsset === "USDC"
      ? parsed.selectedAsset
      : null
    const createdAt = Number(parsed.createdAt || 0)

    if (!selectedAsset || !Number.isFinite(createdAt) || createdAt <= 0) {
      sessionStorage.removeItem(BASE_WC_PENDING_KEY)
      return null
    }

    if (Date.now() - createdAt > BASE_WC_PENDING_TTL_MS) {
      console.log("[Base] Pending Base WC payment stale; clearing")
      sessionStorage.removeItem(BASE_WC_PENDING_KEY)
      return null
    }

    return {
      intentId: parsed.intentId ? String(parsed.intentId) : null,
      selectedAsset,
      createdAt,
    }
  } catch {
    sessionStorage.removeItem(BASE_WC_PENDING_KEY)
    return null
  }
}

function pendingIntentMatches(
  pending: PendingBaseWalletConnectPayment | null,
  intentId?: string,
): boolean {
  if (!pending) return false
  return String(pending.intentId || "") === String(intentId || "")
}

function storePendingBaseWalletConnectPayment(input: {
  intentId?: string
  selectedAsset: BaseAsset
}): void {
  const pending: PendingBaseWalletConnectPayment = {
    intentId: input.intentId || null,
    selectedAsset: input.selectedAsset,
    createdAt: Date.now(),
  }

  sessionStorage.setItem(BASE_WC_PENDING_KEY, JSON.stringify(pending))
  console.log("[Base] Pending Base WC payment stored")
}

function clearPendingBaseWalletConnectPayment(): void {
  sessionStorage.removeItem(BASE_WC_PENDING_KEY)
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

  const { address, chain, isConnected, connector } = useAccount()
  const { connectors, connectAsync, status: connectStatus } = useConnect()
  const { switchChainAsync, status: switchStatus } = useSwitchChain()

  const [localError, setLocalError] = useState("")
  const [resumeMessage, setResumeMessage] = useState("")
  const [hasPendingBaseWcPayment, setHasPendingBaseWcPayment] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    try {
      return pendingIntentMatches(getPendingBaseWalletConnectPayment(), intentId)
    } catch {
      return false
    }
  })
  const [isPreparingPayment, setIsPreparingPayment] = useState(false)
  const [isOpeningWallet, setIsOpeningWallet] = useState(false)
  const [isApprovingUsdc, setIsApprovingUsdc] = useState(false)
  const isSendingBaseTxRef = useRef(false)
  const autoResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isIntentMode = Boolean(intentId)
  const isOnBase = chain?.id === base.id
  const isConnecting = connectStatus === "pending" || switchStatus === "pending"

  const walletConnectConnector = useMemo(
    () => connectors.find(isWalletConnectConnector) || null,
    [connectors]
  )

  console.log("[Base] available connectors", connectors.map(connectorMetadata))

  useEffect(() => {
    void logBase("render", {
      intentId: intentId || null,
      isConnected,
      hasAddress: Boolean(address),
      chainId: chain?.id || null,
      connectorName: connector?.name || null,
      connectorId: connector?.id || null,
    })
  }, [address, chain?.id, connector?.id, connector?.name, intentId, isConnected])

  const refreshPendingState = useCallback(() => {
    const pending = getPendingBaseWalletConnectPayment()
    const matches = pendingIntentMatches(pending, intentId)
    setHasPendingBaseWcPayment(matches)
    if (!matches && pending) {
      clearPendingBaseWalletConnectPayment()
    }
    return matches
  }, [intentId])

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

  const continueBasePayment = useCallback(async (connectedAddress: string) => {
    if (isSendingBaseTxRef.current) return
    isSendingBaseTxRef.current = true

    let createdPaymentId = ""

    try {
      if (!walletConnectConnector) {
        throw new Error("WalletConnect is not configured.")
      }

      const pending = getPendingBaseWalletConnectPayment()
      if (!pendingIntentMatches(pending, intentId)) {
        throw new Error("Base WalletConnect payment session expired. Please try again.")
      }

      const fromAddress = String(connectedAddress || "").trim()
      if (!/^0x[a-fA-F0-9]{40}$/.test(fromAddress)) {
        throw new Error("Wallet connected, but no wallet address was returned.")
      }

      console.log("[Base] Continuing Base payment after WalletConnect")
      await logBase("continue-start", {
        intentId: intentId || null,
        hasAddress: Boolean(fromAddress),
      })

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

      await logBase("resolve-payment-start", { intentId: intentId || null })
      const paymentData = await resolvePaymentData()
      createdPaymentId = paymentData.paymentId
      await logBase("resolve-payment-result", {
        paymentId: paymentData.paymentId,
        hasPaymentUrl: Boolean(paymentData.paymentUrl),
      })
      const txRequest = parseEthereumPaymentUri(paymentData.paymentUrl)
      const walletConnectProvider = await getWalletConnectProvider(walletConnectConnector)

      setIsOpeningWallet(true)
      setResumeMessage("")
      if (selectedAsset === "USDC") {
        const approvalRequest = buildBaseUsdcApprovalTransaction(txRequest)
        setIsApprovingUsdc(true)
        await logBase("usdc-approve-start", {
          token: approvalRequest.to,
          spender: txRequest.to,
          hasData: Boolean(approvalRequest.data),
        })

        const approvalTxHash = await sendWalletConnectTransaction({
          provider: walletConnectProvider,
          fromAddress,
          txRequest: approvalRequest,
        })

        await logBase("usdc-approve-submitted", {
          txHashPrefix: approvalTxHash.slice(0, 10),
        })
        setIsApprovingUsdc(false)
      }

      console.log("[Base] Sending Base transaction via wagmi")
      await logBase("wallet-client-ready", {
        hasAddress: Boolean(fromAddress),
        chainId: base.id,
      })
      await logBase("send-transaction-start", {
        to: txRequest.to,
        hasData: Boolean(txRequest.data),
        hasValue: Boolean(txRequest.value),
      })

      const normalizedTxHash = await sendWalletConnectTransaction({
        provider: walletConnectProvider,
        fromAddress,
        txRequest,
      })

      console.log("[Base] Base tx submitted", { txHash: normalizedTxHash })
      await logBase("tx-submitted", { txHashPrefix: normalizedTxHash.slice(0, 10) })

      await logBase("detect-start", { paymentId: paymentData.paymentId })
      await onSuccess?.(normalizedTxHash, paymentData.paymentId)
      await logBase("detect-finished", { paymentId: paymentData.paymentId })

      clearPendingBaseWalletConnectPayment()
      setHasPendingBaseWcPayment(false)

      if (intentId) {
        window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open Base payment"
      const rejected = isRejectedError(err, message)
      const friendly = rejected
        ? "Wallet connection rejected by user."
        : message

      void logBase("send-transaction-error", { message: friendly, rejected })

      if (rejected || message.toLowerCase().includes("expired") || message.toLowerCase().includes("unavailable")) {
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
      }

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
      setIsApprovingUsdc(false)
      onError?.(friendly)
    } finally {
      isSendingBaseTxRef.current = false
    }
  }, [intentId, isOnBase, onError, onSuccess, resolvePaymentData, selectedAsset, switchChainAsync, walletConnectConnector])

  const startWalletConnectPayment = useCallback(() => {
    setLocalError("")
    setResumeMessage("")

    void (async () => {
      try {
        if (!walletConnectConnector) {
          throw new Error("WalletConnect is not configured.")
        }

        console.log("[Base] WalletConnect selected")
        await logBase("wc-selected", { intentId: intentId || null })
        await logBase("pending-store", { intentId: intentId || null, selectedAsset })

        storePendingBaseWalletConnectPayment({ intentId, selectedAsset })
        setHasPendingBaseWcPayment(true)

        // Show return instructions before the wallet app opens — connectAsync may never
        // return if the OS switches to the wallet app and suspends this tab.
        setResumeMessage(
          "Return here after approving the connection — the transaction will open automatically."
        )

        const currentAddress = String(address || "").trim()
        if (isConnected && currentAddress) {
          // Already connected — skip the connect step
          await continueBasePayment(currentAddress)
          return
        }

        await logBase("connect-start", {
          connectorId: walletConnectConnector?.id || null,
          connectorName: walletConnectConnector?.name || null,
        })

        let fromAddress = ""
        try {
          const result = await connectAsync({ connector: walletConnectConnector, chainId: base.id })
          fromAddress = extractAddressFromConnectResult(result) || currentAddress
          console.log("[Base] WalletConnect connect returned", { hasAddress: Boolean(fromAddress) })
          await logBase("connect-returned", {
            hasAccount: Boolean(fromAddress),
            accountPrefix: fromAddress ? fromAddress.slice(0, 8) : null,
          })
        } catch (connectErr) {
          const connectMsg = connectErr instanceof Error ? connectErr.message : String(connectErr)
          const connectRejected = isRejectedError(connectErr, connectMsg)
          if (connectRejected) {
            // User explicitly cancelled — clear pending and surface error
            clearPendingBaseWalletConnectPayment()
            setHasPendingBaseWcPayment(false)
            setResumeMessage("")
            throw connectErr
          }
          // connectAsync threw without a rejection (e.g. wallet app backgrounded this tab).
          // Pending state survives; manual Send Base transaction button handles continuation.
          await logBase("connect-did-not-return", { message: connectMsg })
          return
        }

        if (fromAddress) {
          await continueBasePayment(fromAddress)
        }
        // No address returned — pending state + manual button handles it
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to open Base payment"
        const rejected = isRejectedError(err, message)
        const friendly = rejected ? "Wallet connection rejected by user." : message

        if (rejected) {
          clearPendingBaseWalletConnectPayment()
          setHasPendingBaseWcPayment(false)
          setResumeMessage("")
        }

        setLocalError(friendly)
        setIsPreparingPayment(false)
        setIsOpeningWallet(false)
        setIsApprovingUsdc(false)
        onError?.(friendly)
      }
    })()
  }, [address, connectAsync, continueBasePayment, intentId, isConnected, onError, selectedAsset, walletConnectConnector])

  const tryResumeBaseWalletConnectPayment = useCallback(() => {
    const pending = getPendingBaseWalletConnectPayment()
    const hasPending = pendingIntentMatches(pending, intentId)

    setHasPendingBaseWcPayment(hasPending)
    if (!hasPending && pending) clearPendingBaseWalletConnectPayment()

    void logBase("auto-resume-check", {
      hasPendingBaseWcPayment: hasPending,
      isConnected,
      hasAddress: Boolean(address),
      isSending: isSendingBaseTxRef.current,
      isOpeningWallet,
      visibilityState: typeof document === "undefined" ? "unknown" : document.visibilityState,
    })

    const skipReason =
      !hasPending ? "no-pending"
      : !isConnected ? "not-connected"
      : !address ? "no-address"
      : isSendingBaseTxRef.current ? "already-sending"
      : isOpeningWallet ? "opening-wallet"
      : null

    if (skipReason) {
      void logBase("auto-resume-skipped", { reason: skipReason })
      return
    }

    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current)
      autoResumeTimerRef.current = null
    }

    void logBase("auto-resume-scheduled", { delayMs: 700 })

    const capturedAddress = String(address)
    autoResumeTimerRef.current = setTimeout(() => {
      autoResumeTimerRef.current = null
      if (isSendingBaseTxRef.current) {
        void logBase("auto-resume-skipped", { reason: "already-sending-on-fire" })
        return
      }
      void logBase("auto-resume-fired", { hasAddress: Boolean(capturedAddress) })
      void continueBasePayment(capturedAddress)
    }, 700)
  }, [address, continueBasePayment, intentId, isConnected, isOpeningWallet])

  useEffect(() => {
    refreshPendingState()
  }, [refreshPendingState])

  useEffect(() => {
    return () => {
      if (autoResumeTimerRef.current) {
        clearTimeout(autoResumeTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    tryResumeBaseWalletConnectPayment()
  }, [tryResumeBaseWalletConnectPayment])

  useEffect(() => {
    window.addEventListener("focus", tryResumeBaseWalletConnectPayment)
    document.addEventListener("visibilitychange", tryResumeBaseWalletConnectPayment)
    window.addEventListener("pageshow", tryResumeBaseWalletConnectPayment)

    return () => {
      window.removeEventListener("focus", tryResumeBaseWalletConnectPayment)
      document.removeEventListener("visibilitychange", tryResumeBaseWalletConnectPayment)
      window.removeEventListener("pageshow", tryResumeBaseWalletConnectPayment)
    }
  }, [tryResumeBaseWalletConnectPayment])

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {isIntentMode ? (
        <>
          <p className="text-lg font-bold text-gray-900">${usdAmount.toFixed(2)} USD</p>
          <p className="text-xs text-gray-500">via Base Network · exact {selectedAsset} determined at payment</p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold text-gray-900">{nativeAmount} {selectedAsset}</p>
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

      {hasPendingBaseWcPayment && !isOpeningWallet ? (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 space-y-2">
          <p>
            {resumeMessage || "Transaction did not open? Tap Send Base transaction."}
          </p>
          <Button
            fullWidth
            variant="secondary"
            onClick={() => {
              void logBase("manual-send-click", { hasAddress: Boolean(address), isConnected })
              if (address) {
                void continueBasePayment(address)
              } else {
                setLocalError(
                  "Wallet connection not detected yet. Tap Reconnect WalletConnect, then return here."
                )
              }
            }}
          >
            Send Base transaction
          </Button>
          {!address ? (
            <Button
              fullWidth
              variant="secondary"
              onClick={() => {
                void logBase("reconnect-click", { intentId: intentId || null })
                if (!walletConnectConnector) return
                void connectAsync({ connector: walletConnectConnector, chainId: base.id })
                  .then((result) => {
                    const addr = extractAddressFromConnectResult(result)
                    if (addr) void continueBasePayment(addr)
                  })
                  .catch(() => null)
              }}
            >
              Reconnect WalletConnect
            </Button>
          ) : null}
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
          {isApprovingUsdc ? "Approving USDC…" : selectedAsset === "USDC" ? "Opening wallet for USDC payment…" : "Opening wallet…"}
        </Button>
      ) : (
        <div className="space-y-2">
          {walletConnectConnector ? (
            <Button fullWidth onClick={() => startWalletConnectPayment()}>
              Pay with {selectedAsset} (Base)
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