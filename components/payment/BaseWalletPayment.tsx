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
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

const BASE_WC_PENDING_KEY = "pinetree_base_wc_pending"
const BASE_WC_PENDING_TTL_MS = 10 * 60 * 1000
const BASE_ETH_AUTO_RESUME_RETRY_MS = 5000
const BASE_ETH_AUTO_RESUME_INTERVAL_MS = 250
const BASE_ETH_TX_REQUEST_TIMEOUT_MS = 90_000
const BASE_ETH_TX_TIMEOUT_MESSAGE = "Transaction approval was not completed. Tap Pay to try again."
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
  if (typeof result === "string") return result.trim()
  if (Array.isArray(result)) return String(result[0] || "").trim()
  if (!result || typeof result !== "object") return ""

  const source = result as {
    accounts?: readonly string[]
    account?: string
    addresses?: readonly string[]
  }

  return String(source.accounts?.[0] || source.account || source.addresses?.[0] || "").trim()
}

function extractAddressFromWalletConnectEvent(args: unknown[]): string {
  for (const arg of args) {
    const address = extractAddressFromConnectResult(arg)
    if (address) return address
  }

  return ""
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
  const autoResumeRetryRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoResumeRetryStartedAtRef = useRef<number>(0)
  const paymentSubmittedRef = useRef(false)
  const prefetchedPaymentDataRef = useRef<PaymentData | null>(null)
  const prefetchedProviderRef = useRef<WalletConnectProvider | null>(null)
  const prefetchedTxRequestRef = useRef<EvmTransactionRequest | null>(null)
  const connectedChainIdRef = useRef<number | null>(null)
  const sessionSettleTriggerFiredRef = useRef(false)

  const isIntentMode = Boolean(intentId)
  const isOnBase = chain?.id === base.id
  const isConnecting = connectStatus === "pending" || switchStatus === "pending"
  const pendingPaymentKey = `${intentId || "direct"}:${selectedAsset}`

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
    if (selectedAsset === "ETH" && paymentSubmittedRef.current) return
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

      console.log("[Base ETH] continue-start", { hasAddress: Boolean(fromAddress) })
      void logBase("continue-start", {
        intentId: intentId || null,
        hasAddress: Boolean(fromAddress),
      })

      // Skip chain switch if wagmi already reports Base or if the WalletConnect session
      // was just established on Base (isOnBase may lag behind the actual connected chain).
      const alreadyOnBase = isOnBase || connectedChainIdRef.current === base.id
      connectedChainIdRef.current = null
      if (!alreadyOnBase) {
        try {
          await switchChainAsync({ chainId: base.id })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!message.toLowerCase().includes("already") && !message.includes(String(base.id))) {
            throw error
          }
        }
      }

      void logBase("resolve-payment-start", { intentId: intentId || null })
      const prefetched = selectedAsset === "ETH" ? prefetchedPaymentDataRef.current : null
      if (prefetched) prefetchedPaymentDataRef.current = null
      const paymentData = prefetched ?? await resolvePaymentData()
      createdPaymentId = paymentData.paymentId
      void logBase("resolve-payment-result", {
        paymentId: paymentData.paymentId,
        hasPaymentUrl: Boolean(paymentData.paymentUrl),
        prefetched: Boolean(prefetched),
      })
      // Use pre-parsed tx request if available (parsed from prefetched payment URL before connect)
      const cachedTxRequest = selectedAsset === "ETH" ? prefetchedTxRequestRef.current : null
      if (cachedTxRequest) prefetchedTxRequestRef.current = null
      const txRequest = cachedTxRequest ?? parseEthereumPaymentUri(paymentData.paymentUrl)
      // Use pre-fetched provider if available (fetched concurrently with connectAsync)
      const cachedProvider = prefetchedProviderRef.current
      prefetchedProviderRef.current = null
      console.log("[Base ETH] provider-ready", { prefetched: Boolean(cachedProvider) })
      void logBase("provider-ready", { prefetched: Boolean(cachedProvider) })
      const walletConnectProvider = cachedProvider ?? await getWalletConnectProvider(walletConnectConnector)

      setIsOpeningWallet(true)
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

      console.log("[Base ETH] eth-sendTransaction-requested", { to: txRequest.to, hasData: Boolean(txRequest.data) })
      void logBase("wallet-client-ready", {
        hasAddress: Boolean(fromAddress),
        chainId: base.id,
      })
      void logBase("eth-sendTransaction-requested", {
        to: txRequest.to,
        hasData: Boolean(txRequest.data),
        hasValue: Boolean(txRequest.value),
      })

      // For ETH: race the transaction request against a timeout so that if the wallet
      // never presents the approval dialog, the checkout clears its "Confirming" state
      // and shows a retry error instead of hanging indefinitely.
      let txTimeoutHandle: ReturnType<typeof setTimeout> | null = null
      const normalizedTxHash = await (selectedAsset === "ETH"
        ? Promise.race([
            sendWalletConnectTransaction({ provider: walletConnectProvider, fromAddress, txRequest }),
            new Promise<never>((_, reject) => {
              txTimeoutHandle = setTimeout(
                () => reject(new Error(BASE_ETH_TX_TIMEOUT_MESSAGE)),
                BASE_ETH_TX_REQUEST_TIMEOUT_MS
              )
            }),
          ])
        : sendWalletConnectTransaction({ provider: walletConnectProvider, fromAddress, txRequest }))
      if (txTimeoutHandle !== null) clearTimeout(txTimeoutHandle)

      paymentSubmittedRef.current = true

      console.log("[Base ETH] eth-sendTransaction-result", { txHashPrefix: normalizedTxHash.slice(0, 10) })
      void logBase("tx-submitted", { txHashPrefix: normalizedTxHash.slice(0, 10) })
      void logBase("eth-sendTransaction-result", { txHashPrefix: normalizedTxHash.slice(0, 10) })

      void logBase("detect-start", { paymentId: paymentData.paymentId })
      await onSuccess?.(normalizedTxHash, paymentData.paymentId)
      void logBase("detect-finished", { paymentId: paymentData.paymentId })

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

      const timedOut = message === BASE_ETH_TX_TIMEOUT_MESSAGE

      void logBase("send-transaction-error", { message: friendly, rejected, timedOut })

      if (rejected || timedOut || message.toLowerCase().includes("expired") || message.toLowerCase().includes("unavailable")) {
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
        // On timeout, also drop pre-fetched payment data so a retry fetches a fresh record.
        if (timedOut) prefetchedPaymentDataRef.current = null
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

        if (selectedAsset === "ETH") {
          // Pre-fetch payment data, provider, and connect concurrently so that
          // eth_sendTransaction can be dispatched immediately after session settles —
          // before the mobile OS can suspend the browser's WalletConnect WebSocket.
          console.log("[Base ETH] connection-started")
          void logBase("connection-started", { intentId: intentId || null })
          const [connectSettled, paymentSettled, providerSettled] = await Promise.allSettled([
            connectAsync({ connector: walletConnectConnector, chainId: base.id }),
            resolvePaymentData(),
            getWalletConnectProvider(walletConnectConnector),
          ])

          if (paymentSettled.status === "fulfilled") {
            prefetchedPaymentDataRef.current = paymentSettled.value
            console.log("[Base ETH] payment-prefetched", { paymentId: paymentSettled.value.paymentId })
            void logBase("payment-prefetched", {
              paymentId: paymentSettled.value.paymentId,
              hasPaymentUrl: Boolean(paymentSettled.value.paymentUrl),
            })
            // Pre-parse the URI so continueBasePayment has zero async work before eth_sendTransaction
            try {
              prefetchedTxRequestRef.current = parseEthereumPaymentUri(paymentSettled.value.paymentUrl)
            } catch {
              prefetchedTxRequestRef.current = null
            }
          }

          if (providerSettled.status === "fulfilled") {
            prefetchedProviderRef.current = providerSettled.value
          }

          if (connectSettled.status === "rejected") {
            const connectErr = connectSettled.reason
            const connectMsg = connectErr instanceof Error ? connectErr.message : String(connectErr)
            const connectRejected = isRejectedError(connectErr, connectMsg)
            if (connectRejected) {
              // Explicit user cancellation — fail any created payment record
              const failId = prefetchedPaymentDataRef.current?.paymentId
              if (failId) {
                await fetch(`/api/payments/${encodeURIComponent(failId)}/fail`, { method: "POST" }).catch(() => null)
                prefetchedPaymentDataRef.current = null
              }
              prefetchedProviderRef.current = null
              prefetchedTxRequestRef.current = null
              clearPendingBaseWalletConnectPayment()
              setHasPendingBaseWcPayment(false)
              throw connectErr
            }
            // Non-rejection: browser was likely suspended. Prefetched data is preserved
            // for use when the session-settle useEffect or focus handlers resume.
            void logBase("connect-did-not-return", { message: connectMsg })
            return
          }

          // Store the chain ID from the connect result so continueBasePayment can skip
          // switchChainAsync when the session was established on Base (wagmi state may lag).
          connectedChainIdRef.current = connectSettled.value.chainId

          const fromAddress = extractAddressFromConnectResult(connectSettled.value) || currentAddress
          console.log("[Base ETH] connect-resolved", { hasAddress: Boolean(fromAddress), chainId: connectedChainIdRef.current })
          void logBase("connect-resolved", {
            hasAccount: Boolean(fromAddress),
            accountPrefix: fromAddress ? fromAddress.slice(0, 8) : null,
            chainId: connectedChainIdRef.current,
          })

          if (fromAddress) {
            await continueBasePayment(fromAddress)
          }
        } else {
          // Non-ETH: original sequential behavior (USDC approval flow unchanged)
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
              clearPendingBaseWalletConnectPayment()
              setHasPendingBaseWcPayment(false)
              throw connectErr
            }
            await logBase("connect-did-not-return", { message: connectMsg })
            return
          }

          if (fromAddress) {
            await continueBasePayment(fromAddress)
          }
        }
        // No address returned — pending state + session-settle/focus handlers resume
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to open Base payment"
        const rejected = isRejectedError(err, message)
        const friendly = rejected ? "Wallet connection rejected by user." : message

        if (rejected) {
          clearPendingBaseWalletConnectPayment()
          setHasPendingBaseWcPayment(false)
        }

        setLocalError(friendly)
        setIsPreparingPayment(false)
        setIsOpeningWallet(false)
        setIsApprovingUsdc(false)
        onError?.(friendly)
      }
    })()
  }, [address, connectAsync, continueBasePayment, intentId, isConnected, onError, resolvePaymentData, selectedAsset, walletConnectConnector])

  const stopAutoResumeRetry = useCallback(() => {
    if (autoResumeRetryRef.current) {
      clearInterval(autoResumeRetryRef.current)
      autoResumeRetryRef.current = null
    }
    autoResumeRetryStartedAtRef.current = 0
  }, [])

  const resumeFromWalletConnectProvider = useCallback(async (source: string) => {
    if (selectedAsset !== "ETH") return false
    if (!pendingIntentMatches(getPendingBaseWalletConnectPayment(), intentId)) return false
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return false
    if (!walletConnectConnector) return false

    try {
      const provider = await getWalletConnectProvider(walletConnectConnector)
      const accounts = await provider.request({ method: "eth_accounts" })
      const providerAddress = extractAddressFromConnectResult(accounts)

      await logBase("auto-resume-provider-check", {
        source,
        hasProviderAddress: Boolean(providerAddress),
      })

      if (!providerAddress) return false

      stopAutoResumeRetry()
      void continueBasePayment(providerAddress)
      return true
    } catch (error) {
      await logBase("auto-resume-provider-check-error", {
        source,
        message: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }, [continueBasePayment, intentId, selectedAsset, stopAutoResumeRetry, walletConnectConnector])

  const tryResumeBaseWalletConnectPayment = useCallback((source = "auto") => {
    const pending = getPendingBaseWalletConnectPayment()
    const hasPending = pendingIntentMatches(pending, intentId)

    setHasPendingBaseWcPayment(hasPending)
    if (!hasPending && pending) {
      clearPendingBaseWalletConnectPayment()
      stopAutoResumeRetry()
    }

    void logBase("auto-resume-check", {
      source,
      hasPendingBaseWcPayment: hasPending,
      selectedAsset,
      isConnected,
      hasAddress: Boolean(address),
      isSending: isSendingBaseTxRef.current,
      paymentSubmitted: paymentSubmittedRef.current,
      isOpeningWallet,
      visibilityState: typeof document === "undefined" ? "unknown" : document.visibilityState,
    })

    const skipReason =
      !hasPending ? "no-pending"
      : selectedAsset !== "ETH" ? "not-eth"
      : !isConnected ? "not-connected"
      : !address ? "no-address"
      : isSendingBaseTxRef.current ? "already-sending"
      : paymentSubmittedRef.current ? "already-submitted"
      : isOpeningWallet ? "opening-wallet"
      : null

    if (skipReason) {
      void logBase("auto-resume-skipped", { reason: skipReason })
      if (skipReason === "not-connected" || skipReason === "no-address") {
        void resumeFromWalletConnectProvider(source)
      }
      return
    }

    stopAutoResumeRetry()

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
      if (paymentSubmittedRef.current) {
        void logBase("auto-resume-skipped", { reason: "already-submitted-on-fire" })
        return
      }
      void logBase("auto-resume-fired", { hasAddress: Boolean(capturedAddress) })
      void continueBasePayment(capturedAddress)
    }, 700)
  }, [address, continueBasePayment, intentId, isConnected, isOpeningWallet, resumeFromWalletConnectProvider, selectedAsset, stopAutoResumeRetry])

  const startBaseEthAutoResumeRetry = useCallback((source: string) => {
    if (selectedAsset !== "ETH") return
    if (!pendingIntentMatches(getPendingBaseWalletConnectPayment(), intentId)) return
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return

    if (!autoResumeRetryRef.current) {
      autoResumeRetryStartedAtRef.current = Date.now()
      void logBase("auto-resume-retry-start", {
        source,
        retryMs: BASE_ETH_AUTO_RESUME_RETRY_MS,
        intervalMs: BASE_ETH_AUTO_RESUME_INTERVAL_MS,
      })

      autoResumeRetryRef.current = setInterval(() => {
        const elapsed = Date.now() - autoResumeRetryStartedAtRef.current
        if (
          elapsed > BASE_ETH_AUTO_RESUME_RETRY_MS ||
          isSendingBaseTxRef.current ||
          paymentSubmittedRef.current ||
          !pendingIntentMatches(getPendingBaseWalletConnectPayment(), intentId)
        ) {
          void logBase("auto-resume-retry-stop", { source, elapsed })
          stopAutoResumeRetry()
          refreshPendingState()
          return
        }

        void resumeFromWalletConnectProvider(`retry-provider:${source}`)
        tryResumeBaseWalletConnectPayment(`retry:${source}`)
      }, BASE_ETH_AUTO_RESUME_INTERVAL_MS)
    }

    void resumeFromWalletConnectProvider(`provider:${source}`)
    tryResumeBaseWalletConnectPayment(source)
  }, [intentId, refreshPendingState, resumeFromWalletConnectProvider, selectedAsset, stopAutoResumeRetry, tryResumeBaseWalletConnectPayment])

  useEffect(() => {
    refreshPendingState()
  }, [refreshPendingState])

  useEffect(() => {
    paymentSubmittedRef.current = false
    isSendingBaseTxRef.current = false
    prefetchedPaymentDataRef.current = null
    prefetchedProviderRef.current = null
    prefetchedTxRequestRef.current = null
    connectedChainIdRef.current = null
    sessionSettleTriggerFiredRef.current = false
    stopAutoResumeRetry()
    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current)
      autoResumeTimerRef.current = null
    }
  }, [pendingPaymentKey, stopAutoResumeRetry])

  useEffect(() => {
    return () => {
      if (autoResumeTimerRef.current) {
        clearTimeout(autoResumeTimerRef.current)
      }
      stopAutoResumeRetry()
    }
  }, [stopAutoResumeRetry])

  useEffect(() => {
    startBaseEthAutoResumeRetry("state-change")
  }, [startBaseEthAutoResumeRetry])

  useEffect(() => {
    const handleFocus = () => startBaseEthAutoResumeRetry("focus")
    const handleVisibilityChange = () => startBaseEthAutoResumeRetry("visibilitychange")
    const handlePageShow = () => startBaseEthAutoResumeRetry("pageshow")

    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("pageshow", handlePageShow)

    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("pageshow", handlePageShow)
    }
  }, [startBaseEthAutoResumeRetry])

  // Session-settle trigger: fires immediately when wagmi reports a connected address
  // for an active pending ETH payment, without waiting for browser focus events.
  // This covers the window where connectAsync resolved (or wagmi reconnected after
  // the WalletConnect session settled) while the browser was briefly active.
  // Fires once per payment intent; focus/visibility/pageshow handlers remain as fallback.
  useEffect(() => {
    if (selectedAsset !== "ETH") return
    if (!isConnected || !address) return
    if (!pendingIntentMatches(getPendingBaseWalletConnectPayment(), intentId)) return
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return
    if (sessionSettleTriggerFiredRef.current) return
    sessionSettleTriggerFiredRef.current = true
    stopAutoResumeRetry()
    void continueBasePayment(address)
  }, [address, continueBasePayment, intentId, isConnected, selectedAsset, stopAutoResumeRetry])

  useEffect(() => {
    if (selectedAsset !== "ETH") return
    if (!walletConnectConnector) return

    let provider: WalletConnectProvider | null = null
    let cancelled = false

    const handleProviderEvent = (...args: unknown[]) => {
      const eventAddress = extractAddressFromWalletConnectEvent(args)
      void logBase("auto-resume-provider-event", {
        hasEventAddress: Boolean(eventAddress),
        argCount: args.length,
      })

      if (eventAddress) {
        if (
          pendingIntentMatches(getPendingBaseWalletConnectPayment(), intentId) &&
          !isSendingBaseTxRef.current &&
          !paymentSubmittedRef.current
        ) {
          stopAutoResumeRetry()
          void continueBasePayment(eventAddress)
        }
        return
      }

      void resumeFromWalletConnectProvider("provider-event")
    }

    void getWalletConnectProvider(walletConnectConnector)
      .then((resolvedProvider) => {
        if (cancelled) return
        provider = resolvedProvider
        provider.on?.("connect", handleProviderEvent)
        provider.on?.("accountsChanged", handleProviderEvent)
        provider.on?.("chainChanged", handleProviderEvent)
        provider.on?.("session_update", handleProviderEvent)
        provider.on?.("session_event", handleProviderEvent)
      })
      .catch(() => null)

    return () => {
      cancelled = true
      provider?.removeListener?.("connect", handleProviderEvent)
      provider?.removeListener?.("accountsChanged", handleProviderEvent)
      provider?.removeListener?.("chainChanged", handleProviderEvent)
      provider?.removeListener?.("session_update", handleProviderEvent)
      provider?.removeListener?.("session_event", handleProviderEvent)
    }
  }, [continueBasePayment, intentId, resumeFromWalletConnectProvider, selectedAsset, stopAutoResumeRetry, walletConnectConnector])

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

      {hasPendingBaseWcPayment && !isOpeningWallet && !isConnecting && !isPreparingPayment ? (
        address ? (
          <div className="text-xs text-gray-500 text-center py-2 flex items-center justify-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border border-gray-400 border-t-transparent animate-spin" />
            Resuming transaction…
          </div>
        ) : (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 space-y-2">
            <p>Wallet disconnected. Reconnect to continue.</p>
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
          </div>
        )
      ) : null}

      {isConnecting ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          Connecting wallet…
        </Button>
      ) : isPreparingPayment ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          Processing payment…
        </Button>
      ) : isOpeningWallet ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          {isApprovingUsdc ? "Approving USDC…" : "Confirming transaction…"}
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