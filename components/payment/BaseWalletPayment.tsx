"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  baseUsdcStrategy?: BaseUsdcStrategy
  onPaymentCreated?: (paymentId: string) => void
  onSuccess?: (txHash: string, paymentId: string) => void | Promise<void>
  onError?: (error: string) => void
}

type BaseUsdcStrategy = "v1_approve_splitToken" | "v4_eip3009_relayer"

type PaymentData = {
  paymentId: string
  paymentUrl: string
  baseUsdcStrategy?: BaseUsdcStrategy
  splitContract?: string
}

type BaseUsdcV4Authorization = {
  validAfter: string
  validBefore: string
  nonce: string
}

type BaseUsdcV4PrepareResponse = {
  ok?: boolean
  unavailable?: boolean
  code?: string
  message?: string
  error?: string
  typedData?: unknown
  authorization?: BaseUsdcV4Authorization
}

type BaseUsdcV4RelayResponse = {
  ok?: boolean
  status?: string
  unavailable?: boolean
  code?: string
  message?: string
  error?: string
  txHash?: string
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

type Eip712TypedData = {
  domain: {
    name?: unknown
    version?: unknown
    chainId?: unknown
    verifyingContract?: unknown
  }
  types: Record<string, Array<{ name: string; type: string }>>
  primaryType: string
  message: Record<string, unknown>
}

const BASE_WC_PENDING_KEY = "pinetree_base_wc_pending"
const BASE_WC_PENDING_TTL_MS = 10 * 60 * 1000
const BASE_ETH_TX_REQUEST_TIMEOUT_MS = 90_000
const BASE_ETH_TX_TIMEOUT_MESSAGE = "Transaction approval was not completed. Tap Pay to try again."
const BASE_USDC_TX_REQUEST_TIMEOUT_MS = 90_000
const BASE_USDC_SIGN_TIMEOUT_MESSAGE = "USDC authorization signature was not completed. Tap Pay to try again."
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Base USDC is temporarily unavailable because current network costs are above PineTree’s limit. Please try again shortly or choose another payment method."


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

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "object" && err !== null) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg) return msg
  }
  if (typeof err === "string" && err) return err
  return ""
}

function extractErrorDetails(err: unknown): Record<string, unknown> {
  if (typeof err === "object" && err !== null) {
    const source = err as {
      code?: unknown
      message?: unknown
      name?: unknown
      shortMessage?: unknown
      details?: unknown
      data?: unknown
      cause?: unknown
    }

    return {
      code: source.code ?? null,
      message: typeof source.message === "string" ? source.message : String(source.message || ""),
      name: source.name ?? null,
      shortMessage: source.shortMessage ?? null,
      details: source.details ?? null,
      data: source.data ?? null,
      causeMessage: extractErrorMessage(source.cause) || null,
    }
  }

  return {
    code: null,
    message: extractErrorMessage(err) || String(err || ""),
  }
}

function isUnsupportedTypedDataMethodError(error: unknown, message: string): boolean {
  const code = typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined
  const normalized = message.toLowerCase()

  return (
    code === -32601 ||
    code === 4200 ||
    normalized.includes("method not found") ||
    normalized.includes("method is not supported") ||
    normalized.includes("unsupported method") ||
    normalized.includes("does not support")
  )
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

function requireBaseUsdcV4TypedData(typedData: unknown, fromAddress: string): Eip712TypedData {
  if (!typedData || typeof typedData !== "object") {
    throw new Error("Invalid Base USDC typed data returned by server")
  }

  const source = typedData as Partial<Eip712TypedData>
  const domain = source.domain
  const message = source.message

  if (!domain || typeof domain !== "object" || !message || typeof message !== "object") {
    throw new Error("Incomplete Base USDC typed data returned by server")
  }

  const normalizedChainId = Number(domain.chainId)
  const verifyingContract = String(domain.verifyingContract || "").trim()
  const payer = String((message as Record<string, unknown>).from || "").trim()
  const to = String((message as Record<string, unknown>).to || "").trim()
  const value = String((message as Record<string, unknown>).value ?? "").trim()
  const validAfter = String((message as Record<string, unknown>).validAfter ?? "").trim()
  const validBefore = String((message as Record<string, unknown>).validBefore ?? "").trim()
  const nonce = String((message as Record<string, unknown>).nonce || "").trim()

  if (String(domain.name || "") !== "USD Coin") {
    throw new Error("Invalid Base USDC typed data domain name")
  }

  if (String(domain.version || "") !== "2") {
    throw new Error("Invalid Base USDC typed data domain version")
  }

  if (normalizedChainId !== base.id) {
    throw new Error("Invalid Base USDC typed data chainId")
  }

  if (verifyingContract.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) {
    throw new Error("Invalid Base USDC typed data verifying contract")
  }

  if (source.primaryType !== "ReceiveWithAuthorization") {
    throw new Error("Invalid Base USDC typed data primary type")
  }

  if (payer.toLowerCase() !== fromAddress.toLowerCase()) {
    throw new Error("Base USDC typed data payer does not match connected wallet")
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
    throw new Error("Invalid Base USDC typed data recipient")
  }

  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
    throw new Error("Invalid Base USDC typed data value")
  }

  if (!/^\d+$/.test(validAfter) || !/^\d+$/.test(validBefore)) {
    throw new Error("Invalid Base USDC typed data validity window")
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(nonce)) {
    throw new Error("Invalid Base USDC typed data nonce")
  }

  return {
    domain: {
      ...domain,
      chainId: normalizedChainId,
      verifyingContract,
    },
    types: source.types || {},
    primaryType: source.primaryType,
    message: {
      ...message,
      from: payer,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
    },
  }
}

function serializeTypedDataForWallet(typedData: Eip712TypedData): string {
  return JSON.stringify(typedData, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  )
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

async function sendWalletConnectTransactionWithTimeout(input: {
  provider: WalletConnectProvider
  fromAddress: string
  txRequest: EvmTransactionRequest
  timeoutMs: number
  timeoutMessage: string
}): Promise<string> {
  let txTimeoutHandle: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      sendWalletConnectTransaction({
        provider: input.provider,
        fromAddress: input.fromAddress,
        txRequest: input.txRequest,
      }),
      new Promise<never>((_, reject) => {
        txTimeoutHandle = setTimeout(
          () => reject(new Error(input.timeoutMessage)),
          input.timeoutMs
        )
      }),
    ])
  } finally {
    if (txTimeoutHandle !== null) clearTimeout(txTimeoutHandle)
  }
}

async function signBaseUsdcV4AuthorizationWithTimeout(input: {
  provider: WalletConnectProvider
  fromAddress: string
  typedData: unknown
}): Promise<string> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const typedData = requireBaseUsdcV4TypedData(input.typedData, input.fromAddress)
  const serializedTypedData = serializeTypedDataForWallet(typedData)

  try {
    const signature = await Promise.race([
      input.provider.request({
        method: "eth_signTypedData_v4",
        params: [input.fromAddress, serializedTypedData],
      }).catch((error) => {
        const message = extractErrorMessage(error) || "Failed to sign Base USDC authorization"
        if (isUnsupportedTypedDataMethodError(error, message)) {
          console.warn("[PineTreeBaseTrace] Base USDC typed-data signing unsupported", {
            step: "base-usdc-v4-sign-unsupported",
            method: "eth_signTypedData_v4",
            ...extractErrorDetails(error),
          })
          throw new Error("Wallet does not support eth_signTypedData_v4 for Base USDC authorization.")
        }
        throw error
      }),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(BASE_USDC_SIGN_TIMEOUT_MESSAGE)),
          BASE_USDC_TX_REQUEST_TIMEOUT_MS
        )
      })
    ])

    const normalized = String(signature || "").trim()
    if (!/^0x[a-fA-F0-9]+$/.test(normalized)) {
      throw new Error("Wallet did not return a valid USDC authorization signature")
    }
    return normalized
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle)
  }
}

function isBaseUsdcV4Unavailable(result: { unavailable?: boolean; code?: string }): boolean {
  return result.unavailable === true || result.code === "BASE_USDC_TEMPORARILY_UNAVAILABLE"
}

function resolveBaseUsdcStrategyFromResponse(result: {
  baseUsdcStrategy?: BaseUsdcStrategy
  metadata?: { split?: { baseUsdcStrategy?: unknown } }
}): BaseUsdcStrategy | undefined {
  const strategy = String(
    result.metadata?.split?.baseUsdcStrategy || result.baseUsdcStrategy || ""
  ).trim()

  if (strategy === "v4_eip3009_relayer" || strategy === "v1_approve_splitToken") {
    return strategy
  }

  return undefined
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

function pendingPaymentMatches(
  pending: PendingBaseWalletConnectPayment | null,
  intentId: string | undefined,
  selectedAsset: BaseAsset,
): boolean {
  if (!pending || !pendingIntentMatches(pending, intentId)) return false
  return pending.selectedAsset === selectedAsset
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
  baseUsdcStrategy: directBaseUsdcStrategy,
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
      return pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset)
    } catch {
      return false
    }
  })
  const [isPreparingPayment, setIsPreparingPayment] = useState(false)
  const [isOpeningWallet, setIsOpeningWallet] = useState(false)
  const [baseUsdcV4Status, setBaseUsdcV4Status] = useState("")
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
  const activeBaseUsdcV4PaymentRef = useRef<string | null>(null)

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
    const matches = pendingPaymentMatches(pending, intentId, selectedAsset)
    setHasPendingBaseWcPayment(matches)
    if (!matches && pending) {
      clearPendingBaseWalletConnectPayment()
    }
    return matches
  }, [intentId, selectedAsset])

  const resolvePaymentData = useCallback(async (): Promise<PaymentData> => {
    if (!isIntentMode) {
      const paymentUrl = String(directPaymentUrl || "").trim()
      const paymentId = String(directPaymentId || "").trim()

      if (!paymentUrl) {
        throw new Error("Payment details unavailable — please contact support.")
      }

      return { paymentId, paymentUrl, baseUsdcStrategy: directBaseUsdcStrategy }
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

      const result = (await res.json()) as {
        paymentId?: string
        paymentUrl?: string
        baseUsdcStrategy?: BaseUsdcStrategy
        metadata?: {
          split?: {
            baseUsdcStrategy?: BaseUsdcStrategy
            splitContract?: string
          }
        }
      }
      const paymentId = String(result.paymentId || "").trim()
      const paymentUrl = String(result.paymentUrl || "").trim()
      const baseUsdcStrategy = resolveBaseUsdcStrategyFromResponse(result)
      const splitContract = String(result.metadata?.split?.splitContract || "").trim() || undefined

      if (!paymentId || !paymentUrl) {
        throw new Error("Incomplete payment data returned from server")
      }

      onPaymentCreated?.(paymentId)

      console.log("BASE PAYMENT URL:", paymentUrl)
      if (selectedAsset === "USDC") {
        console.info("[Base USDC] strategy response", {
          paymentId,
          baseUsdcStrategy,
          splitContract,
          paymentUrlKind: paymentUrl.startsWith("pinetree://base-usdc-v4")
            ? "pinetree://base-usdc-v4"
            : paymentUrl.startsWith("ethereum:")
              ? "ethereum:"
              : "other"
        })
      }

      return { paymentId, paymentUrl, baseUsdcStrategy, splitContract }
    } finally {
      setIsPreparingPayment(false)
    }
  }, [directBaseUsdcStrategy, directPaymentId, directPaymentUrl, intentId, isIntentMode, onPaymentCreated, selectedAsset])

  const executeBaseUsdcV4Payment = useCallback(async (input: {
    paymentData: PaymentData
    provider: WalletConnectProvider
    fromAddress: string
  }): Promise<string> => {
    if (activeBaseUsdcV4PaymentRef.current === input.paymentData.paymentId) {
      throw new Error("Base USDC V4 payment is already in progress. Please wait for the current attempt to finish.")
    }

    activeBaseUsdcV4PaymentRef.current = input.paymentData.paymentId

    try {
    console.info("[Base USDC V4] base-usdc-v4-prepare-start", {
      paymentId: input.paymentData.paymentId
    })
    setBaseUsdcV4Status("Preparing USDC authorization...")
    const prepareRes = await fetch(
      `/api/payments/${encodeURIComponent(input.paymentData.paymentId)}/base-usdc-v4/prepare-authorization`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payerAddress: input.fromAddress })
      }
    )
    const prepare = (await prepareRes.json()) as BaseUsdcV4PrepareResponse
    if (!prepareRes.ok) throw new Error(prepare.error || "Failed to prepare Base USDC authorization")
    if (isBaseUsdcV4Unavailable(prepare)) {
      console.info("[Base USDC V4] base-usdc-v4-unavailable", {
        paymentId: input.paymentData.paymentId,
        stage: "prepare"
      })
      throw new Error(prepare.message || BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE)
    }
    if (!prepare.typedData || !prepare.authorization) {
      throw new Error("Incomplete Base USDC authorization returned by server")
    }

    setBaseUsdcV4Status("Sign USDC payment authorization...")
    console.info("[PineTreeBaseTrace] Base USDC signing start", {
      step: "base-usdc-v4-sign-start",
      paymentId: input.paymentData.paymentId,
      method: "eth_signTypedData_v4",
      typedDataParam: "json-string"
    })
    console.info("[Base USDC V4] base-usdc-v4-signature-requested", {
      paymentId: input.paymentData.paymentId
    })
    let signature = ""
    try {
      signature = await signBaseUsdcV4AuthorizationWithTimeout({
        provider: input.provider,
        fromAddress: input.fromAddress,
        typedData: prepare.typedData
      })
    } catch (signError) {
      console.error("[PineTreeBaseTrace] Base USDC signing failure", {
        step: "base-usdc-v4-sign-failure",
        paymentId: input.paymentData.paymentId,
        method: "eth_signTypedData_v4",
        ...extractErrorDetails(signError),
      })
      throw signError
    }
    if (!/^0x[a-fA-F0-9]+$/.test(signature)) {
      throw new Error("Base USDC relay blocked because no valid authorization signature exists")
    }
    console.info("[PineTreeBaseTrace] Base USDC signing success", {
      step: "base-usdc-v4-sign-success",
      paymentId: input.paymentData.paymentId,
      signaturePrefix: signature.slice(0, 10)
    })
    console.info("[Base USDC V4] base-usdc-v4-signature-received", {
      paymentId: input.paymentData.paymentId,
      signaturePrefix: signature.slice(0, 10)
    })

    setBaseUsdcV4Status("Relaying payment...")
    console.info("[Base USDC V4] base-usdc-v4-relay-start", {
      paymentId: input.paymentData.paymentId
    })
    const relayRes = await fetch(
      `/api/payments/${encodeURIComponent(input.paymentData.paymentId)}/base-usdc-v4/relay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payerAddress: input.fromAddress,
          authorization: prepare.authorization,
          signature
        })
      }
    )
    const relay = (await relayRes.json()) as BaseUsdcV4RelayResponse
    if (!relayRes.ok) throw new Error(relay.error || "Failed to relay Base USDC payment")
    if (isBaseUsdcV4Unavailable(relay)) {
      console.info("[Base USDC V4] base-usdc-v4-unavailable", {
        paymentId: input.paymentData.paymentId,
        stage: "relay"
      })
      throw new Error(relay.message || BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE)
    }

    const txHash = normalizeHexTransactionHash(relay.txHash)
    console.info("[Base USDC V4] base-usdc-v4-relay-result", {
      paymentId: input.paymentData.paymentId,
      status: relay.status || "submitted",
      txHashPrefix: txHash.slice(0, 10)
    })
    setBaseUsdcV4Status("Processing payment...")
    return txHash
    } catch (error) {
      activeBaseUsdcV4PaymentRef.current = null
      throw error
    }
  }, [])

  const continueBasePayment = useCallback(async (connectedAddress: string) => {
    if (isSendingBaseTxRef.current) return
    if (paymentSubmittedRef.current) return
    isSendingBaseTxRef.current = true

    let createdPaymentId = ""
    let createdBaseUsdcV4Payment = false

    try {
      if (!walletConnectConnector) {
        throw new Error("WalletConnect is not configured.")
      }

      const pending = getPendingBaseWalletConnectPayment()
      if (!pendingPaymentMatches(pending, intentId, selectedAsset)) {
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

      setIsOpeningWallet(true)
      void logBase("resolve-payment-start", { intentId: intentId || null })
      const prefetched = selectedAsset === "ETH" || selectedAsset === "USDC"
        ? prefetchedPaymentDataRef.current
        : null
      if (prefetched) prefetchedPaymentDataRef.current = null
      const paymentData = prefetched ?? await resolvePaymentData()
      createdPaymentId = paymentData.paymentId
      void logBase("resolve-payment-result", {
        paymentId: paymentData.paymentId,
        hasPaymentUrl: Boolean(paymentData.paymentUrl),
        prefetched: Boolean(prefetched),
      })
      // Use pre-parsed tx request if available (parsed from prefetched payment URL before connect)
      const cachedTxRequest = selectedAsset === "ETH"
        ? prefetchedTxRequestRef.current
        : null
      if (cachedTxRequest) prefetchedTxRequestRef.current = null
      // Use pre-fetched provider if available (fetched concurrently with connectAsync)
      const cachedProvider = prefetchedProviderRef.current
      prefetchedProviderRef.current = null
      console.log("[Base ETH] provider-ready", { prefetched: Boolean(cachedProvider) })
      void logBase("provider-ready", { prefetched: Boolean(cachedProvider) })
      const walletConnectProvider = cachedProvider ?? await getWalletConnectProvider(walletConnectConnector)

      const isBaseUsdcV4 = selectedAsset === "USDC" && paymentData.baseUsdcStrategy === "v4_eip3009_relayer"
      createdBaseUsdcV4Payment = isBaseUsdcV4

      console.log("[PineTreeBaseTrace] BaseWalletPayment branch selected", {
        step: "branch-selection",
        selectedAsset,
        paymentId: paymentData.paymentId,
        isBaseUsdcV4,
        baseUsdcStrategy: paymentData.baseUsdcStrategy || null
      })

      if (isBaseUsdcV4) {
        console.info("[Base USDC V4] base-usdc-v4-strategy-detected", {
          paymentId: paymentData.paymentId,
          splitContract: paymentData.splitContract,
          paymentUrlKind: paymentData.paymentUrl.startsWith("pinetree://base-usdc-v4")
            ? "pinetree://base-usdc-v4"
            : paymentData.paymentUrl.startsWith("ethereum:")
              ? "ethereum:"
              : "other"
        })
        const normalizedTxHash = await executeBaseUsdcV4Payment({
          paymentData,
          provider: walletConnectProvider,
          fromAddress
        })

        paymentSubmittedRef.current = true
        void logBase("usdc-v4-relayed", { txHashPrefix: normalizedTxHash.slice(0, 10) })
        console.info("[Base USDC V4] base-usdc-v4-detect-start", {
          paymentId: paymentData.paymentId,
          txHashPrefix: normalizedTxHash.slice(0, 10)
        })
        await onSuccess?.(normalizedTxHash, paymentData.paymentId)
        console.info("[Base USDC V4] base-usdc-v4-detect-result", {
          paymentId: paymentData.paymentId,
          txHashPrefix: normalizedTxHash.slice(0, 10)
        })
        activeBaseUsdcV4PaymentRef.current = null

        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)

        if (intentId) {
          window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
        }
        return
      }

      if (selectedAsset === "USDC") {
        throw new Error("Base USDC requires EIP-3009 relayer authorization and cannot use a sendTransaction payment path.")
      }

      const txRequest = cachedTxRequest ?? parseEthereumPaymentUri(paymentData.paymentUrl)

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

      // Race the transaction request against a timeout so that if the wallet never
      // presents the approval dialog, the checkout clears its "Confirming" state
      // and shows a retry error instead of hanging indefinitely.
      let txTimeoutHandle: ReturnType<typeof setTimeout> | null = null
      const normalizedTxHash = await Promise.race([
        sendWalletConnectTransaction({ provider: walletConnectProvider, fromAddress, txRequest }),
        new Promise<never>((_, reject) => {
          txTimeoutHandle = setTimeout(
            () => reject(new Error(BASE_ETH_TX_TIMEOUT_MESSAGE)),
            BASE_ETH_TX_REQUEST_TIMEOUT_MS
          )
        }),
      ])
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
      const message = extractErrorMessage(err) || "Failed to open Base payment"
      const rejected = isRejectedError(err, message)
      const friendly = rejected
        ? "Wallet connection rejected by user."
        : message

      const timedOut =
        message === BASE_ETH_TX_TIMEOUT_MESSAGE ||
        message === BASE_USDC_SIGN_TIMEOUT_MESSAGE

      void logBase("send-transaction-error", {
        message: friendly,
        rejected,
        timedOut,
        selectedAsset,
        paymentId: createdPaymentId || null,
        isBaseUsdcV4: createdBaseUsdcV4Payment,
        errorDetails: extractErrorDetails(err),
      })
      console.error("[PineTreeBaseTrace] BaseWalletPayment error", {
        step: "payment-error",
        selectedAsset,
        intentId: intentId || null,
        paymentId: createdPaymentId || null,
        error: message,
        rejected,
        timedOut,
        isBaseUsdcV4: createdBaseUsdcV4Payment
      })

      // V4 errors always clear pending state — each attempt needs fresh prepare + sign,
      // so auto-resume retrying on a V4 error would only trigger repeated signing prompts.
      const shouldClearPending =
        rejected ||
        timedOut ||
        message.toLowerCase().includes("expired") ||
        message.toLowerCase().includes("unavailable") ||
        createdBaseUsdcV4Payment

      if (shouldClearPending) {
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
        // On timeout, also drop pre-fetched data so a retry fetches a fresh record.
        if (timedOut) {
          prefetchedPaymentDataRef.current = null
          prefetchedTxRequestRef.current = null
        }
      }

      if (rejected && createdPaymentId && !createdBaseUsdcV4Payment) {
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
      setBaseUsdcV4Status("")
      onError?.(friendly)
    } finally {
      isSendingBaseTxRef.current = false
    }
  }, [executeBaseUsdcV4Payment, intentId, isOnBase, onError, onSuccess, resolvePaymentData, selectedAsset, switchChainAsync, walletConnectConnector])

  const startWalletConnectPayment = useCallback(() => {
    setLocalError("")

    void (async () => {
      try {
        if (!walletConnectConnector) {
          throw new Error("WalletConnect is not configured.")
        }

        console.log("[Base] WalletConnect selected")
        console.log("[PineTreeBaseTrace] BaseWalletPayment pay button clicked", {
          step: "button-click",
          selectedAsset,
          intentId: intentId || null,
          isConnected,
          hasAddress: Boolean(address),
          connectorId: walletConnectConnector?.id || null
        })
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

        if (selectedAsset === "ETH" || selectedAsset === "USDC") {
          // Pre-fetch payment data, provider, and connect concurrently so that
          // eth_sendTransaction can be dispatched immediately after session settles —
          // before the mobile OS can suspend the browser's WalletConnect WebSocket.
          console.log("[Base] connection-started", { selectedAsset })
          void logBase("connection-started", { intentId: intentId || null })
          const [connectSettled, paymentSettled, providerSettled] = await Promise.allSettled([
            connectAsync({ connector: walletConnectConnector, chainId: base.id }),
            resolvePaymentData(),
            getWalletConnectProvider(walletConnectConnector),
          ])

          if (paymentSettled.status === "fulfilled") {
            prefetchedPaymentDataRef.current = paymentSettled.value
            console.log("[Base] payment-prefetched", { paymentId: paymentSettled.value.paymentId, selectedAsset })
            void logBase("payment-prefetched", {
              paymentId: paymentSettled.value.paymentId,
              hasPaymentUrl: Boolean(paymentSettled.value.paymentUrl),
              selectedAsset,
            })
            // Pre-parse the URI so continueBasePayment has zero async work before eth_sendTransaction
            if (selectedAsset === "ETH") {
              try {
                prefetchedTxRequestRef.current = parseEthereumPaymentUri(paymentSettled.value.paymentUrl)
              } catch {
                prefetchedTxRequestRef.current = null
              }
            } else {
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
          console.log("[Base] connect-resolved", { selectedAsset, hasAddress: Boolean(fromAddress), chainId: connectedChainIdRef.current })
          void logBase("connect-resolved", {
            hasAccount: Boolean(fromAddress),
            accountPrefix: fromAddress ? fromAddress.slice(0, 8) : null,
            chainId: connectedChainIdRef.current,
            selectedAsset,
          })

          if (fromAddress) {
            await continueBasePayment(fromAddress)
          }
        } else {
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
        const message = extractErrorMessage(err) || "Failed to open Base payment"
        const rejected = isRejectedError(err, message)
        const friendly = rejected ? "Wallet connection rejected by user." : message

        console.error("[PineTreeBaseTrace] BaseWalletPayment startWalletConnectPayment error", {
          step: "start-error",
          selectedAsset,
          intentId: intentId || null,
          error: message,
          rejected
        })

        if (rejected) {
          clearPendingBaseWalletConnectPayment()
          setHasPendingBaseWcPayment(false)
        }

        setLocalError(friendly)
        setIsPreparingPayment(false)
        setIsOpeningWallet(false)
        setBaseUsdcV4Status("")
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
    if (selectedAsset !== "ETH" && selectedAsset !== "USDC") return false
    if (!pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset)) return false
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return false
    if (!walletConnectConnector) return false
    if (!isConnected || !address) {
      await logBase("auto-resume-provider-check-skipped", {
        source,
        reason: !isConnected ? "not-connected" : "no-address",
      })
      return false
    }
    if (!connector || !isWalletConnectConnector(connector)) {
      await logBase("auto-resume-provider-check-skipped", {
        source,
        reason: "active-connector-not-walletconnect",
      })
      return false
    }

    try {
      const provider = await getWalletConnectProvider(walletConnectConnector)
      const providerAddress = String(address || "").trim()

      await logBase("auto-resume-provider-check", {
        source,
        hasProviderAddress: Boolean(providerAddress),
        hasProvider: Boolean(provider),
        chainId: chain?.id || connectedChainIdRef.current || null,
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
  }, [address, chain?.id, connector, continueBasePayment, intentId, isConnected, selectedAsset, stopAutoResumeRetry, walletConnectConnector])

  const tryResumeBaseWalletConnectPayment = useCallback((source = "auto") => {
    const pending = getPendingBaseWalletConnectPayment()
    const hasPending = pendingPaymentMatches(pending, intentId, selectedAsset)

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
      : selectedAsset !== "ETH" && selectedAsset !== "USDC" ? "not-base-asset"
      : activeBaseUsdcV4PaymentRef.current !== null ? "v4-active"
      : !isConnected ? "not-connected"
      : !address ? "no-address"
      : !connector || !isWalletConnectConnector(connector) ? "active-connector-not-walletconnect"
      : isSendingBaseTxRef.current ? "already-sending"
      : paymentSubmittedRef.current ? "already-submitted"
      : isOpeningWallet ? "opening-wallet"
      : null

    if (skipReason) {
      void logBase("auto-resume-skipped", { reason: skipReason })
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
  }, [address, connector, continueBasePayment, intentId, isConnected, isOpeningWallet, selectedAsset, stopAutoResumeRetry])

  const startBaseWalletConnectAutoResumeRetry = useCallback((source: string) => {
    if (selectedAsset !== "ETH" && selectedAsset !== "USDC") return
    if (!pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset)) return
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return
    if (activeBaseUsdcV4PaymentRef.current !== null) return
    if (!isConnected || !address || !connector || !isWalletConnectConnector(connector)) {
      stopAutoResumeRetry()
      void logBase("auto-resume-waiting-for-connected-walletconnect", {
        source,
        isConnected,
        hasAddress: Boolean(address),
        activeConnectorId: connector?.id || null,
      })
      refreshPendingState()
      return
    }

    void resumeFromWalletConnectProvider(`provider:${source}`)
    tryResumeBaseWalletConnectPayment(source)
  }, [address, connector, intentId, isConnected, refreshPendingState, resumeFromWalletConnectProvider, selectedAsset, stopAutoResumeRetry, tryResumeBaseWalletConnectPayment])

  useEffect(() => {
    refreshPendingState()
  }, [refreshPendingState])

  useEffect(() => {
    paymentSubmittedRef.current = false
    isSendingBaseTxRef.current = false
    prefetchedPaymentDataRef.current = null
    prefetchedProviderRef.current = null
    prefetchedTxRequestRef.current = null
    setBaseUsdcV4Status("")
    activeBaseUsdcV4PaymentRef.current = null
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
    startBaseWalletConnectAutoResumeRetry("state-change")
  }, [startBaseWalletConnectAutoResumeRetry])

  useEffect(() => {
    const handleFocus = () => startBaseWalletConnectAutoResumeRetry("focus")
    const handleVisibilityChange = () => startBaseWalletConnectAutoResumeRetry("visibilitychange")
    const handlePageShow = () => startBaseWalletConnectAutoResumeRetry("pageshow")

    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("pageshow", handlePageShow)

    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("pageshow", handlePageShow)
    }
  }, [startBaseWalletConnectAutoResumeRetry])

  // Session-settle trigger: fires immediately when wagmi reports a connected address
  // for an active pending Base WalletConnect payment, without waiting for browser focus events.
  // This covers the window where connectAsync resolved (or wagmi reconnected after
  // the WalletConnect session settled) while the browser was briefly active.
  // Fires once per payment intent; focus/visibility/pageshow handlers remain as fallback.
  useEffect(() => {
    if (selectedAsset !== "ETH" && selectedAsset !== "USDC") return
    if (!isConnected || !address) return
    if (!pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset)) return
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return
    if (sessionSettleTriggerFiredRef.current) return
    sessionSettleTriggerFiredRef.current = true
    // Snapshot the chain ID at session-settle time so continueBasePayment can skip
    // switchChainAsync when the wallet just connected on Base. This ref is consumed
    // and cleared inside continueBasePayment before any chain switch check.
    if (chain?.id) connectedChainIdRef.current = chain.id
    stopAutoResumeRetry()
    void continueBasePayment(address)
  }, [address, chain?.id, continueBasePayment, intentId, isConnected, selectedAsset, stopAutoResumeRetry])

  useEffect(() => {
    if (selectedAsset !== "ETH" && selectedAsset !== "USDC") return
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
          pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset) &&
          !isSendingBaseTxRef.current &&
          !paymentSubmittedRef.current &&
          activeBaseUsdcV4PaymentRef.current === null
        ) {
          stopAutoResumeRetry()
          void continueBasePayment(eventAddress)
        }
        return
      }

      void logBase("auto-resume-provider-event-skipped", {
        reason: "no-address-in-event"
      })
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
          {baseUsdcV4Status || "Processing payment…"}
        </Button>
      ) : isOpeningWallet ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          {baseUsdcV4Status || "Confirming transaction…"}
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