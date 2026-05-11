"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAccount, useConnect, useSwitchChain, useWalletClient } from "wagmi"
import type { Connector } from "wagmi"
import { base } from "wagmi/chains"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
type BaseAsset = "ETH" | "USDC"
type Props = {
  intentId?: string
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  paymentId?: string
  paymentStatus?: string
  selectedAsset?: BaseAsset
  baseUsdcStrategy?: BaseUsdcStrategy
  onPaymentCreated?: (paymentId: string) => void
  onSuccess?: (txHash: string, paymentId: string) => void | Promise<void>
  onError?: (error: string) => void
  onExecutionStarted?: () => void
  onCancel?: () => void
}
type BaseUsdcStrategy = "v1_approve_splitToken" | "v4_eip3009_relayer" | "v5_eip3009_relayer"
type BaseExecutionStage =
  | "idle"
  | "asset_selected"
  | "connecting_wallet"
  | "wallet_connected"
  | "preparing_payment"
  | "confirm_payment"
  | "authorizing_usdc"
  | "usdc_authorized"
  | "submitting_payment"
  | "payment_submitted"
  | "detecting"
  | "confirmed"
  | "retryable_error"
  | "failed"
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
type BaseUsdcV5AllowancePaymentResponse = {
  ok?: boolean
  sufficient?: boolean
  currentAllowance?: string
  requiredAmount?: string
  approveTx?: { to: string; data: string; value: string; chainId: number } | null
  paymentTx?: { to: string; data: string; value: string; chainId: number }
  unavailable?: boolean
  code?: string
  message?: string
  error?: string
}
type DelegatedWalletCall = {
  to: string
  value: string
  data: string
}
type BaseDelegatedPrepareResponse = {
  ok?: boolean
  enabled?: boolean
  paymentId?: string
  payerAddress?: string
  strategy?: "delegated_eoa_batch"
  chainId?: number
  calls?: DelegatedWalletCall[]
  callSummaries?: Array<{ kind: string; to: string; target: string; redacted: boolean }>
  requiredUsdcAmount?: string
  v5Contract?: string
  usdcToken?: string
  warnings?: string[]
  error?: string
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
type BaseWalletClient = {
  signTypedData: (args: {
    account: string
    domain: Eip712TypedData["domain"]
    types: Eip712TypedData["types"]
    primaryType: string
    message: Record<string, unknown>
  }) => Promise<string>
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
const BASE_EXEC_STORAGE_PREFIX = "pinetree_base_exec_"
const BASE_WC_PENDING_TTL_MS = 10 * 60 * 1000
const BASE_ETH_TX_REQUEST_TIMEOUT_MS = 90_000
const BASE_ETH_TX_TIMEOUT_MESSAGE = "Transaction approval was not completed. Tap Pay to try again."
const BASE_USDC_TX_REQUEST_TIMEOUT_MS = 90_000
const BASE_USDC_SIGN_TIMEOUT_MESSAGE = "USDC authorization signature was not completed. Tap Pay to try again."
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Base USDC is temporarily unavailable because current network costs are above PineTree’s limit. Please try again shortly or choose another payment method."
const TERMINAL_PAYMENT_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])
const STAGE_NUM: Record<BaseExecutionStage, number> = {
  idle: 0,
  asset_selected: 1,
  connecting_wallet: 2,
  wallet_connected: 3,
  preparing_payment: 4,
  authorizing_usdc: 5,
  usdc_authorized: 6,
  confirm_payment: 7,
  submitting_payment: 8,
  payment_submitted: 9,
  detecting: 10,
  confirmed: 11,
  retryable_error: -1,
  failed: -2,
}
type PendingBaseWalletConnectPayment = {
  intentId: string | null
  selectedAsset: BaseAsset
  createdAt: number
}
function getBaseAutoResumeKey(input: {
  intentId?: string
  selectedAsset: BaseAsset
  address?: string | null
}): string {
  return [
    input.intentId || "direct",
    input.selectedAsset,
    String(input.address || "unknown").trim().toLowerCase(),
  ].join(":")
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
function shouldTryTypedDataWalletClientFallback(error: unknown, message: string): boolean {
  const code = typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined
  const normalized = message.toLowerCase()
  return (
    isUnsupportedTypedDataMethodError(error, message) ||
    code === -32000 ||
    normalized.includes("failed to sign message") ||
    normalized.includes("failed to sign") ||
    normalized.includes("could not sign")
  )
}
function isValidAuthorizationSignature(value: unknown): value is string {
  return /^0x[a-fA-F0-9]{130}$/.test(String(value || "").trim())
}
function isRejectedError(error: unknown, message: string): boolean {
  return (
    message.toLowerCase().includes("rejected") ||
    message.toLowerCase().includes("reject") ||
    message.toLowerCase().includes("cancel") ||
    (isEip1193Error(error) && error.code === 4001)
  )
}
// Conservative check — only definitive user-initiated rejection signals.
// Transport errors, WalletConnect protocol messages, and session drops that
// contain the word "rejected" must NOT be treated as user rejections.
function isActualUserRejectedError(error: unknown, message: string): boolean {
  const code = typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined
  // EIP-1193: code 4001 is the definitive user-rejection signal across all wallets
  if (code === 4001) return true
  const n = message.toLowerCase().trim()
  // Exact wallet phrases that are unambiguously user-initiated
  if (n === "user rejected the request.") return true
  if (n === "user rejected the request") return true
  if (n === "user denied transaction signature.") return true
  if (n === "user rejected transaction") return true
  if (n === "user rejected") return true
  if (n === "user denied") return true
  if (n === "request rejected") return true
  // Short prefix forms (< 60 chars) that only a wallet sends on deliberate cancel
  if ((n.startsWith("user rejected") || n.startsWith("user denied") || n.startsWith("request rejected")) && n.length <= 60) return true
  // Substring match for unambiguous phrases
  if (n.includes("user rejected the request")) return true
  return false
}
type WalletRequestKind =
  | "connect"
  | "eth_payment"
  | "usdc_delegated"
  | "usdc_signature"
  | "usdc_approve"
  | "usdc_payment"
type ActiveWalletRequest = {
  kind: WalletRequestKind
  startedAt: number
  pending: boolean
  walletName?: string | null
}
type WalletRequestUiState =
  | "idle"
  | "opening_wallet"
  | "awaiting_wallet"
  | "request_sent"
  | "request_resolved"
  | "request_rejected"
  | "request_timeout"
function getFailReason(input: {
  selectedAsset: BaseAsset
  isBaseUsdcV4: boolean
  isBaseUsdcV5: boolean
  rejected: boolean
  timedOut: boolean
  transactionPromptStarted: boolean
}): "user-rejected-transaction" | "transaction-timeout" | null {
  if (input.selectedAsset !== "ETH") return null
  if (input.isBaseUsdcV4) return null
  if (input.isBaseUsdcV5) return null
  if (!input.transactionPromptStarted) return null
  if (input.rejected) return "user-rejected-transaction"
  if (input.timedOut) return "transaction-timeout"
  return null
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
    throw new Error("Invalid Base payment details returned by server")
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
function getWalletConnectPeerName(provider: WalletConnectProvider): string | null {
  const source = provider as {
    session?: {
      peer?: {
        metadata?: {
          name?: unknown
        }
      }
    }
  }
  const name = source.session?.peer?.metadata?.name
  return typeof name === "string" && name.trim() ? name.trim() : null
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
function maybeHexTransactionHash(value: unknown): string | null {
  const txHash = String(value || "").trim()
  return /^0x[a-fA-F0-9]{64}$/.test(txHash) ? txHash : null
}
function extractDirectFinalTxHashFromSendCallsResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null
  const source = result as {
    txHash?: unknown
    transactionHash?: unknown
    hash?: unknown
  }
  return (
    maybeHexTransactionHash(source.transactionHash) ||
    maybeHexTransactionHash(source.txHash) ||
    maybeHexTransactionHash(source.hash)
  )
}
function extractCallIdFromSendCallsResult(result: unknown): string {
  if (!result || typeof result !== "object") return ""
  const source = result as {
    id?: unknown
    callId?: unknown
    bundleId?: unknown
  }
  return String(source.id || source.callId || source.bundleId || "").trim()
}
function extractFinalTxHashFromCallsStatus(result: unknown): string | null {
  if (!result || typeof result !== "object") return null
  const source = result as {
    txHash?: unknown
    transactionHash?: unknown
    receipts?: Array<{ transactionHash?: unknown; txHash?: unknown }>
  }
  const direct = maybeHexTransactionHash(source.transactionHash) || maybeHexTransactionHash(source.txHash)
  if (direct) return direct
  if (Array.isArray(source.receipts)) {
    for (const receipt of source.receipts) {
      const txHash = maybeHexTransactionHash(receipt.transactionHash) || maybeHexTransactionHash(receipt.txHash)
      if (txHash) return txHash
    }
  }
  return null
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
  walletClient?: BaseWalletClient | null
  fromAddress: string
  typedData: unknown
  signingContext: Record<string, unknown>
}): Promise<{ signature: string; method: "A" | "B" }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const typedData = requireBaseUsdcV4TypedData(input.typedData, input.fromAddress)
  const serializedTypedData = serializeTypedDataForWallet(typedData)
  const safeContext = {
    ...input.signingContext,
    payerPrefix: input.fromAddress.slice(0, 10),
    domain: {
      name: typedData.domain.name,
      version: typedData.domain.version,
      chainId: typedData.domain.chainId,
      verifyingContract: typedData.domain.verifyingContract,
    },
    primaryType: typedData.primaryType,
    messageFieldNames: Object.keys(typedData.message),
    typedDataIsJsonString: typeof serializedTypedData === "string",
  }
  const sign = async (): Promise<{ signature: string; method: "A" | "B" }> => {
    await logBase("usdc-sign-method-start", {
      method: "A",
      requestMethod: "eth_signTypedData_v4",
      ...safeContext,
    })
    try {
      const signature = await input.provider.request({
        method: "eth_signTypedData_v4",
        params: [input.fromAddress, serializedTypedData],
      })
      const normalized = String(signature || "").trim()
      if (!isValidAuthorizationSignature(normalized)) {
        throw new Error("Wallet did not return a valid USDC authorization signature")
      }
      await logBase("usdc-sign-success", {
        method: "A",
        signaturePrefix: normalized.slice(0, 10),
      })
      return { signature: normalized, method: "A" }
    } catch (methodAError) {
      const methodAMessage = extractErrorMessage(methodAError) || "Failed to sign Base USDC authorization"
      await logBase("usdc-sign-method-failed", {
        method: "A",
        ...extractErrorDetails(methodAError),
      })
      if (!shouldTryTypedDataWalletClientFallback(methodAError, methodAMessage)) {
        throw methodAError
      }
    }
    await logBase("usdc-sign-method-start", {
      method: "B",
      requestMethod: "walletClient.signTypedData",
      walletClientAvailable: Boolean(input.walletClient?.signTypedData),
      ...safeContext,
    })
    if (!input.walletClient?.signTypedData) {
      await logBase("usdc-sign-method-failed", {
        method: "B",
        code: "WALLET_CLIENT_UNAVAILABLE",
        message: "Wagmi walletClient.signTypedData is not available",
      })
      throw new Error("This wallet could not sign the Base USDC authorization. Try another WalletConnect wallet for Base USDC.")
    }
    try {
      const signature = await input.walletClient.signTypedData({
        account: input.fromAddress,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      })
      const normalized = String(signature || "").trim()
      if (!isValidAuthorizationSignature(normalized)) {
        throw new Error("Wallet did not return a valid USDC authorization signature")
      }
      await logBase("usdc-sign-success", {
        method: "B",
        signaturePrefix: normalized.slice(0, 10),
      })
      return { signature: normalized, method: "B" }
    } catch (methodBError) {
      await logBase("usdc-sign-method-failed", {
        method: "B",
        ...extractErrorDetails(methodBError),
      })
      throw new Error("This wallet could not sign the Base USDC authorization. Try another WalletConnect wallet for Base USDC.")
    }
  }
  try {
    return await Promise.race([
      sign(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(BASE_USDC_SIGN_TIMEOUT_MESSAGE)),
          BASE_USDC_TX_REQUEST_TIMEOUT_MS
        )
      })
    ])
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
  if (
    strategy === "v5_eip3009_relayer" ||
    strategy === "v4_eip3009_relayer" ||
    strategy === "v1_approve_splitToken"
  ) {
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
function normalizeTerminalPaymentStatus(status: string): string {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "CANCELLED") return "CANCELED"
  return normalized
}
function isTerminalPaymentStatus(status: string): boolean {
  return TERMINAL_PAYMENT_STATUSES.has(normalizeTerminalPaymentStatus(status))
}
function clearBaseExecutionSessionStorage(): void {
  try {
    sessionStorage.removeItem(BASE_WC_PENDING_KEY)
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(BASE_EXEC_STORAGE_PREFIX)) {
        sessionStorage.removeItem(key)
      }
    }
  } catch {
    // best-effort only
  }
}
export default function BaseWalletPayment({
  intentId,
  paymentUrl: directPaymentUrl,
  nativeAmount,
  usdAmount,
  paymentId: directPaymentId,
  paymentStatus = "",
  selectedAsset = "ETH",
  baseUsdcStrategy: directBaseUsdcStrategy,
  onPaymentCreated,
  onSuccess,
  onError,
  onExecutionStarted,
  onCancel,
}: Props) {
  const { address, chain, isConnected, connector } = useAccount()
  const { connectors, connectAsync, status: connectStatus } = useConnect()
  const { switchChainAsync, status: switchStatus } = useSwitchChain()
  const { data: walletClient } = useWalletClient({ chainId: base.id })
  const [localError, setLocalError] = useState("")
  const [defensiveTerminalStatus, setDefensiveTerminalStatus] = useState("")
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
  const autoResumeAttemptedKeyRef = useRef<string | null>(null)
  const paymentSubmittedRef = useRef(false)
  const prefetchedPaymentDataRef = useRef<PaymentData | null>(null)
  const prefetchedProviderRef = useRef<WalletConnectProvider | null>(null)
  const prefetchedTxRequestRef = useRef<EvmTransactionRequest | null>(null)
  const connectedChainIdRef = useRef<number | null>(null)
  const sessionSettleTriggerFiredRef = useRef(false)
  const activeBaseUsdcV4PaymentRef = useRef<string | null>(null)
  const activeBaseUsdcV5PaymentRef = useRef<string | null>(null)
  const activeBasePaymentAttemptRef = useRef<string | null>(null)
  // Tracks a live wallet request (connect / sign / send) so we know whether
  // the user is currently in-wallet. While pending=true we never show rejection UI.
  const activeWalletRequestRef = useRef<ActiveWalletRequest | null>(null)
  const [walletHandoffPending, setWalletHandoffPending] = useState(false)
  const [walletRequestUiState, setWalletRequestUiState] = useState<WalletRequestUiState>("idle")
  const [pendingWalletRequestKind, setPendingWalletRequestKind] = useState<WalletRequestKind | null>(null)
  // ── Base UI execution state machine ────────────────────────────────────────
  const [execStage, setExecStageRaw] = useState<BaseExecutionStage>("idle")
  const [usedEmergencyAllowance, setUsedEmergencyAllowance] = useState(false)
  // Tracks the brief address-resolution wait after WalletConnect session settles
  const [isResolvingAccount, setIsResolvingAccount] = useState(false)
  // Mirrors wagmi address so async callbacks can read latest value without closure staleness
  const addressRef = useRef<string | undefined>(undefined)
  addressRef.current = address
  const execStageRef = useRef<BaseExecutionStage>("idle")
  // Stable ref so useCallbacks with [] deps always call the latest setter logic
  const setExecStageRef = useRef<(stage: BaseExecutionStage, opts?: { allowance?: boolean }) => void>(() => {})
  setExecStageRef.current = (stage, opts) => {
    const prev = execStageRef.current
    if (prev === stage) return
    console.log("[BASE UI] stage-change", { from: prev, to: stage, asset: selectedAsset, intentId: intentId ?? null })
    execStageRef.current = stage
    setExecStageRaw(stage)
    if (opts?.allowance) setUsedEmergencyAllowance(true)
    try {
      sessionStorage.setItem(`pinetree_base_exec_${intentId ?? "direct"}_${selectedAsset}`, stage)
    } catch {}
  }
  const setIsResolvingAccountRef = useRef<(v: boolean) => void>(() => {})
  setIsResolvingAccountRef.current = setIsResolvingAccount
  const isIntentMode = Boolean(intentId)
  const propTerminalStatus = isTerminalPaymentStatus(paymentStatus)
    ? normalizeTerminalPaymentStatus(paymentStatus)
    : ""
  const terminalStatus = propTerminalStatus || defensiveTerminalStatus
  const isOnBase = chain?.id === base.id
  const isConnecting = connectStatus === "pending" || switchStatus === "pending"
  const pendingPaymentKey = `${intentId || "direct"}:${selectedAsset}`
  const walletConnectConnector = useMemo(
    () => connectors.find(isWalletConnectConnector) || null,
    [connectors]
  )
  const beginWalletRequest = useCallback((request: Omit<ActiveWalletRequest, "startedAt" | "pending">) => {
    activeWalletRequestRef.current = {
      ...request,
      startedAt: Date.now(),
      pending: true,
    }
    setPendingWalletRequestKind(request.kind)
    setWalletHandoffPending(false)
    setWalletRequestUiState(request.kind === "connect" ? "opening_wallet" : "awaiting_wallet")
  }, [])
  const resolveWalletRequest = useCallback(() => {
    activeWalletRequestRef.current = null
    setWalletRequestUiState("request_resolved")
    setPendingWalletRequestKind(null)
    setWalletHandoffPending(false)
  }, [])
  const rejectWalletRequest = useCallback(() => {
    activeWalletRequestRef.current = null
    setWalletRequestUiState("request_rejected")
    setPendingWalletRequestKind(null)
    setWalletHandoffPending(false)
  }, [])
  const timeoutWalletRequest = useCallback(() => {
    activeWalletRequestRef.current = null
    setWalletRequestUiState("request_timeout")
    setPendingWalletRequestKind(null)
    setWalletHandoffPending(false)
  }, [])
  const preservePendingWalletRequestUi = useCallback((kind: WalletRequestKind | null) => {
    setPendingWalletRequestKind(kind)
    setWalletRequestUiState("request_sent")
    setWalletHandoffPending(true)
  }, [])
  const resolveTerminalStatusBeforeWalletConnect = useCallback(async (): Promise<string> => {
    if (propTerminalStatus) return propTerminalStatus
    const query = intentId
      ? `intentId=${encodeURIComponent(intentId)}`
      : directPaymentId
        ? `paymentId=${encodeURIComponent(directPaymentId)}`
        : ""
    if (!query) return ""
    try {
      const res = await fetch(`/api/payments/status?${query}`, { cache: "no-store" })
      if (!res.ok) return ""
      const data = (await res.json()) as { status?: string }
      const resolvedStatus = normalizeTerminalPaymentStatus(String(data.status || ""))
      return isTerminalPaymentStatus(resolvedStatus) ? resolvedStatus : ""
    } catch {
      return ""
    }
  }, [directPaymentId, intentId, propTerminalStatus])
  const enforceActivePaymentBeforeWalletConnect = useCallback(async (): Promise<boolean> => {
    const resolvedTerminalStatus = await resolveTerminalStatusBeforeWalletConnect()
    if (!resolvedTerminalStatus) return true
    clearBaseExecutionSessionStorage()
    setHasPendingBaseWcPayment(false)
    setDefensiveTerminalStatus(resolvedTerminalStatus)
    setLocalError("")
    setIsPreparingPayment(false)
    setIsOpeningWallet(false)
    setExecStageRef.current("idle")
    await logBase("terminal-guard-blocked-walletconnect", {
      intentId: intentId || null,
      paymentId: directPaymentId || null,
      status: resolvedTerminalStatus,
      selectedAsset,
    })
    return false
  }, [directPaymentId, intentId, resolveTerminalStatusBeforeWalletConnect, selectedAsset])
  useEffect(() => {
    if (!propTerminalStatus) return
    clearBaseExecutionSessionStorage()
    setHasPendingBaseWcPayment(false)
    setDefensiveTerminalStatus(propTerminalStatus)
    setLocalError("")
    setIsPreparingPayment(false)
    setIsOpeningWallet(false)
    setIsResolvingAccount(false)
    execStageRef.current = "idle"
    setExecStageRaw("idle")
  }, [propTerminalStatus])
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
          paymentUrlKind: paymentUrl.startsWith("pinetree://base-usdc-v5")
            ? "pinetree://base-usdc-v5"
            : paymentUrl.startsWith("pinetree://base-usdc-v4")
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
    walletClient?: BaseWalletClient | null
    fromAddress: string
    signingContext: Record<string, unknown>
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
    setExecStageRef.current("confirm_payment")
    console.log("[BASE UI] awaiting-wallet-confirmation", { paymentId: input.paymentData.paymentId, strategy: "v4_eip3009_relayer" })
    setBaseUsdcV4Status("Sign USDC payment authorization...")
    const peerName = getWalletConnectPeerName(input.provider)
    console.info("[PineTreeBaseTrace] Base USDC signing start", {
      step: "base-usdc-v4-sign-start",
      paymentId: input.paymentData.paymentId,
      method: "eth_signTypedData_v4",
      typedDataParam: "json-string",
      peerName
    })
    console.info("[Base USDC V4] base-usdc-v4-signature-requested", {
      paymentId: input.paymentData.paymentId
    })
    beginWalletRequest({ kind: "usdc_signature", walletName: peerName })
    let signature = ""
    let signMethod: "A" | "B" = "A"
    try {
      const signResult = await signBaseUsdcV4AuthorizationWithTimeout({
        provider: input.provider,
        walletClient: input.walletClient,
        fromAddress: input.fromAddress,
        typedData: prepare.typedData,
        signingContext: {
          ...input.signingContext,
          providerPeerName: peerName,
        }
      })
      signature = signResult.signature
      signMethod = signResult.method
      resolveWalletRequest()
    } catch (signError) {
      const signMsg = extractErrorMessage(signError)
      const signRejected = isRejectedError(signError, signMsg)
      if (peerName && peerName.toLowerCase().includes("trust wallet") && !signRejected) {
        activeWalletRequestRef.current = null
        void logBase("usdc-wallet-unsupported-for-typed-data", {
          providerPeerName: peerName,
          connectorId: String(input.signingContext.connectorId || ""),
          paymentId: input.paymentData.paymentId,
        })
        throw new Error(
          "Trust Wallet could not authorize this Base USDC payment. Try another supported wallet or choose another payment method."
        )
      }
      console.error("[PineTreeBaseTrace] Base USDC signing failure", {
        step: "base-usdc-v4-sign-failure",
        paymentId: input.paymentData.paymentId,
        method: "typed-data-compatible",
        ...extractErrorDetails(signError),
      })
      throw signError
    }
    if (!isValidAuthorizationSignature(signature)) {
      throw new Error("Base USDC relay blocked because no valid authorization signature exists")
    }
    console.info("[PineTreeBaseTrace] Base USDC signing success", {
      step: "base-usdc-v4-sign-success",
      paymentId: input.paymentData.paymentId,
      method: signMethod,
      signaturePrefix: signature.slice(0, 10)
    })
    console.info("[Base USDC V4] base-usdc-v4-signature-received", {
      paymentId: input.paymentData.paymentId,
      signaturePrefix: signature.slice(0, 10)
    })
    setBaseUsdcV4Status("Relaying payment...")
    void logBase("relay-start", { paymentId: input.paymentData.paymentId })
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
    void logBase("relay-success", {
      paymentId: input.paymentData.paymentId,
      txHashPrefix: txHash.slice(0, 10),
    })
    setBaseUsdcV4Status("Processing payment...")
    return txHash
    } catch (error) {
      activeBaseUsdcV4PaymentRef.current = null
      throw error
    }
  }, [])
  const executeBaseUsdcV5Payment = useCallback(async (input: {
    paymentData: PaymentData
    provider: WalletConnectProvider
    walletClient?: BaseWalletClient | null
    fromAddress: string
    peerName: string | null
    signingContext: Record<string, unknown>
  }): Promise<string> => {
    if (activeBaseUsdcV5PaymentRef.current === input.paymentData.paymentId) {
      throw new Error("Base USDC V5 payment is already in progress. Please wait for the current attempt to finish.")
    }
    activeBaseUsdcV5PaymentRef.current = input.paymentData.paymentId
    const paymentId = input.paymentData.paymentId
    const isTrustWallet = Boolean(input.peerName && input.peerName.toLowerCase().includes("trust"))
    try {
      let authTxHash: string | null = null
      let shouldUseAllowancePath = false
      void logBase("usdc-strategy-selected", {
        paymentId,
        strategy: "delegated-eoa-first",
        eip3009Skipped: isTrustWallet,
        peerName: input.peerName,
      })
      // ── Strategy 1: Delegated EOA batch (wallet_sendCalls) ──────────────────
      // Attempts [USDC.approve + V5.payUsdcWithAllowance] as a single wallet approval.
      // Falls through silently to next strategy if: feature disabled server-side, wallet
      // does not support wallet_sendCalls, or the prepare call fails non-fatally.
      // User rejection and unresolvable confirmation are propagated as errors.
      let delegatedFallthrough = false
      try {
        setBaseUsdcV4Status("Preparing payment...")
        const delegatedPrepareRes = await fetch(
          `/api/payments/${encodeURIComponent(paymentId)}/base-usdc-v5/delegated/prepare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payerAddress: input.fromAddress }),
          }
        )
        const delegatedPrepared = (await delegatedPrepareRes.json()) as BaseDelegatedPrepareResponse
        if (
          delegatedPrepared.ok &&
          delegatedPrepared.enabled &&
          Array.isArray(delegatedPrepared.calls) &&
          delegatedPrepared.calls.length >= 2
        ) {
          console.info("[BASE DELEGATED] batch-start", { paymentId })
          setExecStageRef.current("confirm_payment")
          console.log("[BASE UI] awaiting-wallet-confirmation", { paymentId, strategy: "delegated_eoa_batch" })
          setBaseUsdcV4Status("Confirm payment in your wallet...")
          let sendCallsResult: unknown
          beginWalletRequest({ kind: "usdc_delegated", walletName: input.peerName })
          try {
            sendCallsResult = await input.provider.request({
              method: "wallet_sendCalls",
              params: [
                {
                  version: "2.0.0",
                  from: input.fromAddress,
                  chainId: decimalOrHexToHex(String(base.id)),
                  calls: delegatedPrepared.calls.map((call) => ({
                    to: call.to,
                    value: call.value || "0x0",
                    data: call.data || "0x",
                  })),
                  capabilities: {},
                },
              ],
            })
            console.info("[BASE DELEGATED] wallet-send-calls-sent", { paymentId })
          } catch (sendCallsErr) {
            const sendMsg = extractErrorMessage(sendCallsErr)
            if (isRejectedError(sendCallsErr, sendMsg)) throw sendCallsErr
            activeWalletRequestRef.current = null
            // wallet_sendCalls unsupported or method not found — fall through to next strategy
            console.info("[BASE DELEGATED] wallet-send-calls-unsupported", { paymentId, error: sendMsg })
            delegatedFallthrough = true
          }
          if (!delegatedFallthrough) resolveWalletRequest()
          if (!delegatedFallthrough) {
            let finalTxHash = extractDirectFinalTxHashFromSendCallsResult(sendCallsResult)
            const callId = extractCallIdFromSendCallsResult(sendCallsResult)
            if (!finalTxHash && !callId) {
              throw new Error("Payment submitted but confirmation details were not returned. Please try again.")
            }
            if (!finalTxHash && callId) {
              setExecStageRef.current("submitting_payment")
              setBaseUsdcV4Status("Waiting for confirmation...")
              const maxAttempts = 20
              const delayMs = 3_000
              for (let attempt = 1; attempt <= maxAttempts && !finalTxHash; attempt++) {
                try {
                  const statusResult = await input.provider.request({
                    method: "wallet_getCallsStatus",
                    params: [callId],
                  })
                  finalTxHash = extractFinalTxHashFromCallsStatus(statusResult)
                  if (finalTxHash) break
                } catch {
                  break
                }
                if (attempt < maxAttempts && !finalTxHash) {
                  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
                }
              }
            }
            if (!finalTxHash) {
              throw new Error("Payment confirmation was not returned by wallet. Please try again.")
            }
            console.info("[BASE DELEGATED] final-tx-resolved", {
              paymentId,
              txHashPrefix: finalTxHash.slice(0, 10),
            })
            setBaseUsdcV4Status("Processing payment...")
            return normalizeHexTransactionHash(finalTxHash)
          }
        } else {
          // Feature disabled server-side or unexpected response — fall through
          console.info("[BASE DELEGATED] batch-disabled-or-unavailable", {
            paymentId,
            enabled: delegatedPrepared.enabled,
          })
          delegatedFallthrough = true
        }
      } catch (delegatedErr) {
        const delegatedMsg = extractErrorMessage(delegatedErr)
        if (isRejectedError(delegatedErr, delegatedMsg)) throw delegatedErr
        if (
          delegatedMsg.startsWith("Payment submitted") ||
          delegatedMsg.startsWith("Payment confirmation")
        ) {
          // Retryable: payment went through but txHash unresolvable
          throw delegatedErr
        }
        if (!delegatedFallthrough) {
          console.info("[BASE DELEGATED] error-falling-through-to-next-strategy", { paymentId, error: delegatedMsg })
        }
      }
      // ── Strategy 2: EIP-3009 relayer ────────────────────────────────────────
      if (!isTrustWallet) {
        try {
          setBaseUsdcV4Status("Preparing USDC authorization...")
          console.info("[PineTreeBaseTrace] v5 prepare-authorization start", {
            step: "v5-prepare-start",
            paymentId,
            peerName: input.peerName
          })
          const prepareRes = await fetch(
            `/api/payments/${encodeURIComponent(paymentId)}/base-usdc-v5/prepare`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ payerAddress: input.fromAddress })
            }
          )
          const prepare = (await prepareRes.json()) as BaseUsdcV4PrepareResponse
          if (!prepareRes.ok) throw new Error(prepare.error || "Failed to prepare Base USDC V5 authorization")
          if (isBaseUsdcV4Unavailable(prepare)) throw new Error(prepare.message || BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE)
          if (!prepare.typedData || !prepare.authorization) throw new Error("Incomplete Base USDC V5 authorization returned by server")
          setExecStageRef.current("confirm_payment")
          console.log("[BASE UI] awaiting-wallet-confirmation", { paymentId, strategy: "eip3009_relayer" })
          setBaseUsdcV4Status("Authorize USDC payment...")
          const typedData = requireBaseUsdcV4TypedData(prepare.typedData, input.fromAddress)
          const serializedTypedData = serializeTypedDataForWallet(typedData)
          let signTimeoutHandle: ReturnType<typeof setTimeout> | null = null
          let signature = ""
          void logBase("usdc-auth-start", { paymentId })
          beginWalletRequest({ kind: "usdc_signature", walletName: input.peerName })
          try {
            const rawSig = await Promise.race([
              input.provider.request({ method: "eth_signTypedData_v4", params: [input.fromAddress, serializedTypedData] }),
              new Promise<never>((_, reject) => {
                signTimeoutHandle = setTimeout(() => reject(new Error(BASE_USDC_SIGN_TIMEOUT_MESSAGE)), BASE_USDC_TX_REQUEST_TIMEOUT_MS)
              })
            ])
            if (signTimeoutHandle) clearTimeout(signTimeoutHandle)
            resolveWalletRequest()
            signature = String(rawSig || "").trim()
            if (!isValidAuthorizationSignature(signature)) throw new Error("Wallet did not return a valid USDC V5 authorization signature")
            void logBase("usdc-auth-success", { paymentId, signaturePrefix: signature.slice(0, 10) })
          } catch (signErrA) {
            if (signTimeoutHandle) clearTimeout(signTimeoutHandle)
            const signMsgA = extractErrorMessage(signErrA)
            if (isRejectedError(signErrA, signMsgA) || signMsgA === BASE_USDC_SIGN_TIMEOUT_MESSAGE) {
              throw signErrA
            }
            activeWalletRequestRef.current = null
            if (input.walletClient?.signTypedData && shouldTryTypedDataWalletClientFallback(signErrA, signMsgA)) {
              try {
                signature = await input.walletClient.signTypedData({
                  account: input.fromAddress,
                  domain: typedData.domain,
                  types: typedData.types,
                  primaryType: typedData.primaryType,
                  message: typedData.message,
                })
                if (!isValidAuthorizationSignature(signature)) throw new Error("Wallet did not return a valid USDC V5 authorization signature")
                void logBase("usdc-auth-success", { paymentId, method: "walletClient", signaturePrefix: signature.slice(0, 10) })
              } catch (signErrB) {
                const signMsgB = extractErrorMessage(signErrB)
                if (isRejectedError(signErrB, signMsgB)) throw signErrB
                void logBase("usdc-auth-failed-switching-to-guided-two-step", { paymentId, error: signMsgB, method: "walletClient" })
                shouldUseAllowancePath = true
              }
            } else {
              void logBase("usdc-auth-failed-switching-to-guided-two-step", { paymentId, error: signMsgA, method: "provider" })
              shouldUseAllowancePath = true
            }
          }
          if (!shouldUseAllowancePath && signature) {
            setBaseUsdcV4Status("Relaying payment...")
            console.info("[PineTreeBaseTrace] v5 relay start", { step: "v5-relay-start", paymentId })
            const relayRes = await fetch(
              `/api/payments/${encodeURIComponent(paymentId)}/base-usdc-v5/relay`,
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
            if (!relayRes.ok) throw new Error(relay.error || "Failed to relay Base USDC V5 payment")
            if (isBaseUsdcV4Unavailable(relay)) throw new Error(relay.message || BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE)
            authTxHash = normalizeHexTransactionHash(relay.txHash)
            console.info("[PineTreeBaseTrace] v5 relay success", { step: "v5-relay-success", paymentId, txHashPrefix: authTxHash.slice(0, 10) })
          }
        } catch (authErr) {
          const authMsg = extractErrorMessage(authErr)
          if (
            isRejectedError(authErr, authMsg) ||
            authMsg === BASE_USDC_SIGN_TIMEOUT_MESSAGE ||
            isBaseUsdcV4Unavailable(authErr as { unavailable?: boolean; code?: string })
          ) {
            throw authErr
          }
          console.warn("[PineTreeBaseTrace] v5 authorization path error — falling through to allowance", {
            step: "v5-auth-path-error-fallback",
            paymentId,
            error: authMsg
          })
          shouldUseAllowancePath = true
        }
      }
      if (authTxHash) {
        setBaseUsdcV4Status("Processing payment...")
        return authTxHash
      }
      // ── Allowance path ────────────────────────────────────────────────────────
      console.info("[PineTreeBaseTrace] v5 allowance path start", {
        step: "v5-allowance-start",
        paymentId,
        isTrustWallet
      })
      setBaseUsdcV4Status("Preparing USDC payment...")
      const buildRes = await fetch(
        `/api/payments/${encodeURIComponent(paymentId)}/base-usdc-v5/build-allowance-payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payerAddress: input.fromAddress })
        }
      )
      const buildData = (await buildRes.json()) as BaseUsdcV5AllowancePaymentResponse
      if (!buildRes.ok) throw new Error(buildData.error || "Failed to build Base USDC V5 allowance payment")
      if (isBaseUsdcV4Unavailable(buildData)) throw new Error(buildData.message || BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE)
      if (!buildData.ok) throw new Error("Failed to build Base USDC V5 allowance payment")
      if (!buildData.paymentTx) throw new Error("Incomplete allowance payment data returned by server")
      const { sufficient, approveTx, paymentTx } = buildData as Required<Pick<BaseUsdcV5AllowancePaymentResponse, "sufficient" | "approveTx" | "paymentTx">>
      if (!sufficient && approveTx) {
        setExecStageRef.current("authorizing_usdc", { allowance: true })
        console.log("[BASE UI] usdc-authorization-start", { paymentId })
        setBaseUsdcV4Status("Step 1 of 2: Authorize USDC...")
        void logBase("usdc-approve-requested", { paymentId, isTrustWallet })
        beginWalletRequest({ kind: "usdc_approve", walletName: input.peerName })
        const approveTxHash = await sendWalletConnectTransactionWithTimeout({
          provider: input.provider,
          fromAddress: input.fromAddress,
          txRequest: approveTx,
          timeoutMs: BASE_USDC_TX_REQUEST_TIMEOUT_MS,
          timeoutMessage: "USDC authorization approval was not completed. Tap Pay to try again."
        })
        resolveWalletRequest()
        void logBase("usdc-approve-submitted", { paymentId, txHashPrefix: approveTxHash.slice(0, 10) })
        setBaseUsdcV4Status("Waiting for USDC authorization...")
        const maxWaitMs = 120_000
        const pollIntervalMs = 3_000
        const pollStartedAt = Date.now()
        let allowanceSufficient = false
        while (!allowanceSufficient && Date.now() - pollStartedAt < maxWaitMs) {
          await new Promise<void>(resolve => setTimeout(resolve, pollIntervalMs))
          if (!isSendingBaseTxRef.current) break
          try {
            const checkRes = await fetch(
              `/api/payments/${encodeURIComponent(paymentId)}/base-usdc-v5/allowance-check`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ payerAddress: input.fromAddress })
              }
            )
            const checkData = (await checkRes.json()) as { ok?: boolean; sufficient?: boolean }
            if (checkData.ok && checkData.sufficient) {
              allowanceSufficient = true
            }
          } catch {
            // Continue polling on transient errors
          }
        }
        if (!allowanceSufficient) {
          throw new Error("USDC allowance was not confirmed in time. Please try again.")
        }
        setExecStageRef.current("usdc_authorized")
        console.log("[BASE UI] usdc-authorization-confirmed", { paymentId })
        void logBase("usdc-allowance-confirmed", { paymentId })
      }
      setExecStageRef.current("confirm_payment")
      console.log("[BASE UI] awaiting-wallet-confirmation", { paymentId, strategy: "allowance_two_step" })
      setBaseUsdcV4Status("Step 2 of 2: Confirm payment...")
      void logBase("usdc-payment-requested", { paymentId, isTrustWallet })
      beginWalletRequest({ kind: "usdc_payment", walletName: input.peerName })
      const paymentTxHash = await sendWalletConnectTransactionWithTimeout({
        provider: input.provider,
        fromAddress: input.fromAddress,
        txRequest: paymentTx,
        timeoutMs: BASE_USDC_TX_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Payment transaction was not completed. Tap Pay to try again."
      })
      resolveWalletRequest()
      setBaseUsdcV4Status("Processing payment...")
      void logBase("usdc-payment-submitted", { paymentId, txHashPrefix: paymentTxHash.slice(0, 10) })
      return paymentTxHash
    } catch (error) {
      activeBaseUsdcV5PaymentRef.current = null
      throw error
    }
  }, [])
  const continueBasePayment = useCallback(async (connectedAddress: string) => {
    if (isSendingBaseTxRef.current) return
    if (paymentSubmittedRef.current) return
    isSendingBaseTxRef.current = true
    let createdPaymentId = ""
    let createdBaseUsdcV4Payment = false
    let createdBaseUsdcV5Payment = false
    let transactionPromptStarted = false
    let activeAttemptKey = ""
    try {
      if (!walletConnectConnector) {
        throw new Error("WalletConnect is not configured.")
      }
      const isActivePayment = await enforceActivePaymentBeforeWalletConnect()
      if (!isActivePayment) return
      const pending = getPendingBaseWalletConnectPayment()
      if (!pendingPaymentMatches(pending, intentId, selectedAsset)) {
        throw new Error("Base WalletConnect payment session expired. Please try again.")
      }
      let fromAddress = String(connectedAddress || "").trim()
      if (!/^0x[a-fA-F0-9]{40}$/.test(fromAddress)) {
        // Address not yet available — WalletConnect session may have settled but
        // wagmi / the provider hasn't propagated the account yet. Show a benign
        // "Finalizing…" state and poll briefly before giving up.
        setExecStageRef.current("wallet_connected")
        setIsResolvingAccountRef.current(true)
        const ADDR_RESOLVE_DEADLINE = Date.now() + 4000
        const ADDR_RESOLVE_POLL_MS = 300
        while (!/^0x[a-fA-F0-9]{40}$/.test(fromAddress) && Date.now() < ADDR_RESOLVE_DEADLINE) {
          await new Promise<void>((r) => setTimeout(r, ADDR_RESOLVE_POLL_MS))
          // 1. Try the wagmi address ref (updated on every render)
          const wagmiAddr = String(addressRef.current || "").trim()
          if (/^0x[a-fA-F0-9]{40}$/.test(wagmiAddr)) {
            fromAddress = wagmiAddr
            break
          }
          // 2. Try a direct provider eth_accounts request
          if (walletConnectConnector) {
            try {
              const prov = prefetchedProviderRef.current ?? await getWalletConnectProvider(walletConnectConnector)
              const accounts = await prov.request({ method: "eth_accounts", params: [] })
              const provAddr = extractAddressFromConnectResult(accounts)
              if (/^0x[a-fA-F0-9]{40}$/.test(provAddr)) {
                fromAddress = provAddr
                break
              }
            } catch {
              // continue polling
            }
          }
        }
        setIsResolvingAccountRef.current(false)
        if (!/^0x[a-fA-F0-9]{40}$/.test(fromAddress)) {
          throw new Error("Wallet connection could not be completed. Tap Try Again.")
        }
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
      setExecStageRef.current("preparing_payment")
      void logBase("resolve-payment-start", { intentId: intentId || null })
      const prefetched = selectedAsset === "ETH" || selectedAsset === "USDC"
        ? prefetchedPaymentDataRef.current
        : null
      if (prefetched) prefetchedPaymentDataRef.current = null
      const paymentData = prefetched ?? await resolvePaymentData()
      createdPaymentId = paymentData.paymentId
      activeAttemptKey = `${paymentData.paymentId}:${selectedAsset}`
      if (activeBasePaymentAttemptRef.current && activeBasePaymentAttemptRef.current === activeAttemptKey) {
        void logBase("auto-resume-skipped", { reason: "active-attempt-lock", activeAttemptKey })
        setIsOpeningWallet(false)
        return
      }
      if (activeBasePaymentAttemptRef.current && activeBasePaymentAttemptRef.current !== activeAttemptKey) {
        void logBase("auto-resume-skipped", {
          reason: "different-active-attempt-lock",
          activeAttemptKey: activeBasePaymentAttemptRef.current,
          nextAttemptKey: activeAttemptKey,
        })
        setIsOpeningWallet(false)
        return
      }
      activeBasePaymentAttemptRef.current = activeAttemptKey
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
      const isBaseUsdcV5 = selectedAsset === "USDC" && (
        paymentData.baseUsdcStrategy === "v5_eip3009_relayer" ||
        paymentData.paymentUrl.startsWith("pinetree://base-usdc-v5")
      )
      const isBaseUsdcV4 = !isBaseUsdcV5 && selectedAsset === "USDC" && paymentData.baseUsdcStrategy === "v4_eip3009_relayer"
      createdBaseUsdcV4Payment = isBaseUsdcV4
      createdBaseUsdcV5Payment = isBaseUsdcV5
      console.log("[PineTreeBaseTrace] BaseWalletPayment branch selected", {
        step: "branch-selection",
        selectedAsset,
        paymentId: paymentData.paymentId,
        isBaseUsdcV4,
        isBaseUsdcV5,
        baseUsdcStrategy: paymentData.baseUsdcStrategy || null
      })
      if (isBaseUsdcV5) {
        console.info("[Base USDC V5] v5-strategy-detected", {
          paymentId: paymentData.paymentId,
          splitContract: paymentData.splitContract,
          paymentUrlKind: paymentData.paymentUrl.startsWith("pinetree://base-usdc-v5")
            ? "pinetree://base-usdc-v5"
            : "other"
        })
        const peerName = getWalletConnectPeerName(walletConnectProvider)
        const normalizedTxHash = await executeBaseUsdcV5Payment({
          paymentData,
          provider: walletConnectProvider,
          walletClient: (walletClient as BaseWalletClient | undefined) || null,
          fromAddress,
          peerName,
          signingContext: {
            connectorName: connector?.name || walletConnectConnector.name || null,
            connectorId: connector?.id || walletConnectConnector.id || null,
            chainId: chain?.id || connectedChainIdRef.current || base.id,
          }
        })
        paymentSubmittedRef.current = true
        activeBasePaymentAttemptRef.current = null
        activeBaseUsdcV5PaymentRef.current = null
        setExecStageRef.current("payment_submitted")
        console.log("[BASE UI] final-tx-submitted", { paymentId: paymentData.paymentId, txHashPrefix: normalizedTxHash.slice(0, 10), asset: "USDC" })
        void logBase("detect-start", { paymentId: paymentData.paymentId, txHashPrefix: normalizedTxHash.slice(0, 10) })
        setExecStageRef.current("detecting")
        console.log("[BASE UI] detecting", { paymentId: paymentData.paymentId })
        await onSuccess?.(normalizedTxHash, paymentData.paymentId)
        void logBase("detect-success", { paymentId: paymentData.paymentId })
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
        if (intentId) {
          window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
        }
        return
      }
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
          walletClient: (walletClient as BaseWalletClient | undefined) || null,
          fromAddress,
          signingContext: {
            connectorName: connector?.name || walletConnectConnector.name || null,
            connectorId: connector?.id || walletConnectConnector.id || null,
            chainId: chain?.id || connectedChainIdRef.current || base.id,
          }
        })
        paymentSubmittedRef.current = true
        activeBasePaymentAttemptRef.current = null
        setExecStageRef.current("payment_submitted")
        console.log("[BASE UI] final-tx-submitted", { paymentId: paymentData.paymentId, txHashPrefix: normalizedTxHash.slice(0, 10), asset: "USDC", strategy: "v4" })
        void logBase("detect-start", { paymentId: paymentData.paymentId, txHashPrefix: normalizedTxHash.slice(0, 10) })
        setExecStageRef.current("detecting")
        console.log("[BASE UI] detecting", { paymentId: paymentData.paymentId })
        await onSuccess?.(normalizedTxHash, paymentData.paymentId)
        void logBase("detect-success", { paymentId: paymentData.paymentId })
        activeBaseUsdcV4PaymentRef.current = null
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
        if (intentId) {
          window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
        }
        return
      }
      if (selectedAsset === "USDC") {
        throw new Error("Base USDC payment could not be prepared. Please try again or choose another payment method.")
      }
      const txRequest = cachedTxRequest ?? parseEthereumPaymentUri(paymentData.paymentUrl)
      void logBase("eth-payment-requested", {
        paymentId: paymentData.paymentId,
        to: txRequest.to,
        hasData: Boolean(txRequest.data),
        hasValue: Boolean(txRequest.value),
      })
      transactionPromptStarted = true
      setExecStageRef.current("confirm_payment")
      console.log("[BASE UI] awaiting-wallet-confirmation", { paymentId: paymentData.paymentId, asset: "ETH" })
      // Race the transaction request against a timeout so that if the wallet never
      // presents the approval dialog, the checkout clears its "Confirming" state
      // and shows a retry error instead of hanging indefinitely.
      const ethPeerName = getWalletConnectPeerName(walletConnectProvider)
      beginWalletRequest({ kind: "eth_payment", walletName: ethPeerName })
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
      resolveWalletRequest()
      paymentSubmittedRef.current = true
      activeBasePaymentAttemptRef.current = null
      setExecStageRef.current("payment_submitted")
      console.log("[BASE UI] final-tx-submitted", { paymentId: paymentData.paymentId, txHashPrefix: normalizedTxHash.slice(0, 10), asset: "ETH" })
      void logBase("eth-payment-submitted", { txHashPrefix: normalizedTxHash.slice(0, 10) })
      void logBase("detect-start", { paymentId: paymentData.paymentId })
      setExecStageRef.current("detecting")
      console.log("[BASE UI] detecting", { paymentId: paymentData.paymentId })
      await onSuccess?.(normalizedTxHash, paymentData.paymentId)
      void logBase("detect-success", { paymentId: paymentData.paymentId })
      clearPendingBaseWalletConnectPayment()
      setHasPendingBaseWcPayment(false)
      if (intentId) {
        window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
      }
    } catch (err) {
      const message = extractErrorMessage(err) || "Failed to open Base payment"
      // Read wallet request state before clearing it
      const walletWasPending = Boolean(activeWalletRequestRef.current?.pending)
      const walletKind = activeWalletRequestRef.current?.kind ?? null
      const walletName = activeWalletRequestRef.current?.walletName ?? null
      activeWalletRequestRef.current = null
      // Use conservative rejection check for all user-facing decisions.
      // isRejectedError is intentionally broad for internal flow-control (strategy fallthrough);
      // isActualUserRejectedError is used here so that WalletConnect transport errors,
      // session resets, and iOS handoff interrupts are never shown as user rejections.
      const rejected = isActualUserRejectedError(err, message)
      const timedOut =
        message === BASE_ETH_TX_TIMEOUT_MESSAGE ||
        message === BASE_USDC_SIGN_TIMEOUT_MESSAGE
      // Ambiguous error during a live wallet request = handoff scenario (user is in-wallet)
      const isHandoff = walletWasPending && !rejected && !timedOut &&
        !message.toLowerCase().includes("expired") &&
        !message.toLowerCase().includes("unavailable")
      if (rejected) {
        rejectWalletRequest()
      } else if (timedOut) {
        timeoutWalletRequest()
      }
      const friendly = rejected
        ? (walletKind === "connect"
            ? "Wallet connection declined. Tap Try Again to retry."
            : "Payment declined. Tap Try Again to retry.")
        : isHandoff
          ? "Confirm payment in your wallet, or tap Try Again to restart."
          : message
      const failReason = getFailReason({
        selectedAsset,
        isBaseUsdcV4: createdBaseUsdcV4Payment,
        isBaseUsdcV5: createdBaseUsdcV5Payment,
        rejected,
        timedOut,
        transactionPromptStarted,
      })
      const isRetryableUsdcSigningFailure =
        (createdBaseUsdcV4Payment || createdBaseUsdcV5Payment) &&
        !rejected &&
        !timedOut
      void logBase("send-transaction-error", {
        message: friendly,
        rejected,
        timedOut,
        isHandoff,
        walletKind,
        walletName,
        selectedAsset,
        paymentId: createdPaymentId || null,
        isBaseUsdcV4: createdBaseUsdcV4Payment,
        transactionPromptStarted,
        failReason,
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
        isHandoff,
        transactionPromptStarted,
        failReason,
        isBaseUsdcV4: createdBaseUsdcV4Payment,
        isBaseUsdcV5: createdBaseUsdcV5Payment
      })
      const shouldClearPending =
        rejected ||
        timedOut ||
        message.toLowerCase().includes("expired") ||
        message.toLowerCase().includes("unavailable")
      if (shouldClearPending) {
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
        if (timedOut) {
          prefetchedPaymentDataRef.current = null
          prefetchedTxRequestRef.current = null
        }
      }
      if (failReason && createdPaymentId) {
        activeBasePaymentAttemptRef.current = null
        void logBase("fail-called", {
          paymentId: createdPaymentId,
          reason: failReason,
        })
        await fetch(`/api/payments/${encodeURIComponent(createdPaymentId)}/fail`, {
          method: "POST",
        }).catch(() => null)
        if (intentId) {
          window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=cancelled`
          return
        }
      }
      if (isRetryableUsdcSigningFailure) {
        if (!isHandoff) {
          clearPendingBaseWalletConnectPayment()
          setHasPendingBaseWcPayment(false)
          activeBasePaymentAttemptRef.current = null
          activeBaseUsdcV4PaymentRef.current = null
          activeBaseUsdcV5PaymentRef.current = null
        }
      }
      if (isHandoff) {
        preservePendingWalletRequestUi(walletKind)
        setExecStageRef.current(walletKind === "usdc_approve" ? "authorizing_usdc" : "confirm_payment")
        console.log("[BASE UI] wallet-handoff-pending", { message: friendly, walletKind, selectedAsset, intentId: intentId || null })
        setLocalError("")
        setIsPreparingPayment(false)
        setIsOpeningWallet(false)
        if (walletKind === "usdc_approve") {
          setBaseUsdcV4Status("Authorize USDC in your wallet...")
        } else {
          setBaseUsdcV4Status("Confirm payment in your wallet...")
        }
        return
      }
      setExecStageRef.current("retryable_error")
      console.log("[BASE UI] retryable-error", { message: friendly, isHandoff, walletKind, selectedAsset, intentId: intentId || null })
      setLocalError(friendly)
      setIsPreparingPayment(false)
      setIsOpeningWallet(false)
      setBaseUsdcV4Status("")
      onError?.(friendly)
    } finally {
      isSendingBaseTxRef.current = false
    }
  }, [chain?.id, connector?.id, connector?.name, enforceActivePaymentBeforeWalletConnect, executeBaseUsdcV4Payment, executeBaseUsdcV5Payment, intentId, isOnBase, onError, onSuccess, resolvePaymentData, selectedAsset, switchChainAsync, walletClient, walletConnectConnector])
  const resetBasePaymentAttemptForRetry = useCallback(() => {
    activeBasePaymentAttemptRef.current = null
    activeBaseUsdcV4PaymentRef.current = null
    activeBaseUsdcV5PaymentRef.current = null
    activeWalletRequestRef.current = null
    setWalletRequestUiState("idle")
    setPendingWalletRequestKind(null)
    isSendingBaseTxRef.current = false
    paymentSubmittedRef.current = false
    sessionSettleTriggerFiredRef.current = false
    prefetchedPaymentDataRef.current = null
    prefetchedTxRequestRef.current = null
    autoResumeAttemptedKeyRef.current = null
    setBaseUsdcV4Status("")
    setIsResolvingAccount(false)
    clearPendingBaseWalletConnectPayment()
    setHasPendingBaseWcPayment(false)
    execStageRef.current = "idle"
    setExecStageRaw("idle")
    setUsedEmergencyAllowance(false)
    setWalletHandoffPending(false)
  }, [])
  const startWalletConnectPayment = useCallback(() => {
    void (async () => {
      try {
        const isActivePayment = await enforceActivePaymentBeforeWalletConnect()
        if (!isActivePayment) return
        resetBasePaymentAttemptForRetry()
        setLocalError("")
        setExecStageRef.current("asset_selected")
        if (!walletConnectConnector) {
          throw new Error("WalletConnect is not configured.")
        }
        console.log("[Base] WalletConnect selected")
        console.log("[BASE UI] execution-start", {
          selectedAsset,
          intentId: intentId || null,
        })
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
        setExecStageRef.current("connecting_wallet")
        onExecutionStarted?.()
        const currentAddress = String(address || "").trim()
        if (isConnected && currentAddress) {
          // Already connected — skip the connect step
          setExecStageRef.current("wallet_connected")
          console.log("[BASE UI] wallet-connected", { source: "already-connected", intentId: intentId || null })
          await continueBasePayment(currentAddress)
          return
        }
        void logBase("wc-connect-start", {
          connectorId: walletConnectConnector?.id || null,
          connectorName: walletConnectConnector?.name || null,
          selectedAsset,
          intentId: intentId || null,
        })
        beginWalletRequest({ kind: "connect", walletName: null })
        if (selectedAsset === "ETH" || selectedAsset === "USDC") {
          // Pre-fetch payment data, provider, and connect concurrently so that
          // splitEth / USDC requests can be dispatched immediately after session settles —
          // before the mobile OS can suspend the browser's WalletConnect WebSocket.
          const paymentPromise = resolvePaymentData()
          const providerPromise = getWalletConnectProvider(walletConnectConnector)
          const connectPromise = connectAsync({ connector: walletConnectConnector, chainId: base.id })
          void paymentPromise
            .then((paymentData) => {
              prefetchedPaymentDataRef.current = paymentData
              console.log("[Base] payment-prefetched", { paymentId: paymentData.paymentId, selectedAsset })
              void logBase("payment-prefetched", {
                paymentId: paymentData.paymentId,
                hasPaymentUrl: Boolean(paymentData.paymentUrl),
                selectedAsset,
              })
              if (selectedAsset === "ETH") {
                try {
                  prefetchedTxRequestRef.current = parseEthereumPaymentUri(paymentData.paymentUrl)
                } catch {
                  prefetchedTxRequestRef.current = null
                }
              } else {
                prefetchedTxRequestRef.current = null
              }
            })
            .catch((error) => {
              void logBase("payment-prefetch-failed", {
                message: extractErrorMessage(error) || String(error || ""),
                selectedAsset,
              })
            })
          void providerPromise
            .then((provider) => {
              prefetchedProviderRef.current = provider
            })
            .catch(() => null)
          let connectResult: Awaited<ReturnType<typeof connectAsync>>
          try {
            connectResult = await connectPromise
            resolveWalletRequest()
          } catch (connectErr) {
            const connectMsg = connectErr instanceof Error ? connectErr.message : String(connectErr)
            const connectRejected = isActualUserRejectedError(connectErr, connectMsg)
            if (connectRejected) {
              rejectWalletRequest()
              prefetchedPaymentDataRef.current = null
              prefetchedProviderRef.current = null
              prefetchedTxRequestRef.current = null
              clearPendingBaseWalletConnectPayment()
              setHasPendingBaseWcPayment(false)
              throw connectErr
            }
            activeWalletRequestRef.current = null
            preservePendingWalletRequestUi("connect")
            // Non-rejection (transport error, iOS handoff, browser suspended).
            // Prefetched data is preserved for session-settle / focus handlers to resume.
            void logBase("connect-did-not-return", { message: connectMsg })
            return
          }
          // Store the chain ID from the connect result so continueBasePayment can skip
          // switchChainAsync when the session was established on Base (wagmi state may lag).
          connectedChainIdRef.current = connectResult.chainId
          const fromAddress = extractAddressFromConnectResult(connectResult) || currentAddress
          if (fromAddress) {
            setExecStageRef.current("wallet_connected")
            console.log("[BASE UI] wallet-connected", { intentId: intentId || null, selectedAsset })
            void logBase("wc-connect-success", {
              hasAddress: Boolean(fromAddress),
              chainId: connectedChainIdRef.current,
              selectedAsset,
            })
          }
          if (fromAddress) {
            await continueBasePayment(fromAddress)
          }
        } else {
          let fromAddress = ""
          try {
            const result = await connectAsync({ connector: walletConnectConnector, chainId: base.id })
            resolveWalletRequest()
            fromAddress = extractAddressFromConnectResult(result) || currentAddress
            if (fromAddress) {
              setExecStageRef.current("wallet_connected")
              console.log("[BASE UI] wallet-connected", { intentId: intentId || null, selectedAsset })
              void logBase("wc-connect-success", {
                hasAddress: Boolean(fromAddress),
                selectedAsset,
              })
            }
          } catch (connectErr) {
            const connectMsg = connectErr instanceof Error ? connectErr.message : String(connectErr)
            const connectRejected = isActualUserRejectedError(connectErr, connectMsg)
            if (connectRejected) {
              rejectWalletRequest()
              clearPendingBaseWalletConnectPayment()
              setHasPendingBaseWcPayment(false)
              throw connectErr
            }
            activeWalletRequestRef.current = null
            preservePendingWalletRequestUi("connect")
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
        const rejected = isActualUserRejectedError(err, message)
        if (rejected) {
          rejectWalletRequest()
        } else {
          activeWalletRequestRef.current = null
        }
        const friendly = rejected
          ? "Wallet connection declined. Tap Try Again to retry."
          : message
        console.error("[PineTreeBaseTrace] BaseWalletPayment startWalletConnectPayment error", {
          step: "start-error",
          selectedAsset,
          intentId: intentId || null,
          error: message,
          rejected
        })
        if (rejected) {
          activeBasePaymentAttemptRef.current = null
          clearPendingBaseWalletConnectPayment()
          setHasPendingBaseWcPayment(false)
        }
        setExecStageRef.current("retryable_error")
        console.log("[BASE UI] retryable-error", { message: friendly, selectedAsset })
        setLocalError(friendly)
        setIsPreparingPayment(false)
        setIsOpeningWallet(false)
        setBaseUsdcV4Status("")
        onError?.(friendly)
      }
    })()
  }, [address, connectAsync, continueBasePayment, enforceActivePaymentBeforeWalletConnect, intentId, isConnected, onError, onExecutionStarted, resetBasePaymentAttemptForRetry, resolvePaymentData, selectedAsset, walletConnectConnector])
  const stopAutoResumeRetry = useCallback(() => {
    if (autoResumeRetryRef.current) {
      clearInterval(autoResumeRetryRef.current)
      autoResumeRetryRef.current = null
    }
    autoResumeRetryStartedAtRef.current = 0
  }, [])
  const markAutomaticResumeAttempt = useCallback((source: string, resumeAddress?: string | null): boolean => {
    const resumeKey = getBaseAutoResumeKey({
      intentId,
      selectedAsset,
      address: resumeAddress || address || null,
    })
    if (autoResumeAttemptedKeyRef.current === resumeKey) {
      void logBase("auto-resume-skipped", {
        source,
        reason: "auto-resume-already-attempted",
        resumeKey,
      })
      return false
    }
    autoResumeAttemptedKeyRef.current = resumeKey
    void logBase("auto-resume-claimed", { source, resumeKey })
    return true
  }, [address, intentId, selectedAsset])
  const resumeFromWalletConnectProvider = useCallback(async (source: string) => {
    if (selectedAsset !== "ETH" && selectedAsset !== "USDC") return false
    if (activeWalletRequestRef.current?.pending) {
      await logBase("auto-resume-provider-check-skipped", {
        source,
        reason: "wallet-request-pending",
        walletRequestKind: activeWalletRequestRef.current.kind,
      })
      return false
    }
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
      if (!markAutomaticResumeAttempt(source, providerAddress)) return false
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
  }, [address, chain?.id, connector, continueBasePayment, intentId, isConnected, markAutomaticResumeAttempt, selectedAsset, stopAutoResumeRetry, walletConnectConnector])
  const tryResumeBaseWalletConnectPayment = useCallback((source = "auto") => {
    const pending = getPendingBaseWalletConnectPayment()
    const hasPending = pendingPaymentMatches(pending, intentId, selectedAsset)
    setHasPendingBaseWcPayment(hasPending)
    if (!hasPending && pending) {
      clearPendingBaseWalletConnectPayment()
      stopAutoResumeRetry()
    }
    if (hasPending) {
      void logBase("auto-resume-check", {
        source,
        selectedAsset,
        isConnected,
        hasAddress: Boolean(address),
        isSending: isSendingBaseTxRef.current,
        paymentSubmitted: paymentSubmittedRef.current,
        isOpeningWallet,
      })
    }
    const skipReason =
      !hasPending ? "no-pending"
      : selectedAsset !== "ETH" && selectedAsset !== "USDC" ? "not-base-asset"
      : activeBasePaymentAttemptRef.current !== null ? "active-attempt-lock"
      : activeBaseUsdcV4PaymentRef.current !== null ? "v4-active"
      : activeBaseUsdcV5PaymentRef.current !== null ? "v5-active"
      : isConnecting ? "connecting"
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
    void logBase("auto-resume-scheduled", { delayMs: 50 })
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
      if (activeBasePaymentAttemptRef.current !== null) {
        void logBase("auto-resume-skipped", { reason: "attempt-lock-on-fire" })
        return
      }
      if (activeBaseUsdcV4PaymentRef.current !== null) {
        void logBase("auto-resume-skipped", { reason: "v4-active-on-fire" })
        return
      }
      if (activeBaseUsdcV5PaymentRef.current !== null) {
        void logBase("auto-resume-skipped", { reason: "v5-active-on-fire" })
        return
      }
      if (!markAutomaticResumeAttempt(source, capturedAddress)) return
      void logBase("auto-resume-fired", { hasAddress: Boolean(capturedAddress) })
      void continueBasePayment(capturedAddress)
    }, 50)
  }, [address, connector, continueBasePayment, intentId, isConnected, isOpeningWallet, markAutomaticResumeAttempt, selectedAsset, stopAutoResumeRetry])
  const startBaseWalletConnectAutoResumeRetry = useCallback((source: string) => {
    if (terminalStatus) return
    if (selectedAsset !== "ETH" && selectedAsset !== "USDC") return
    if (!pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset)) return
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return
    if (activeBasePaymentAttemptRef.current !== null) return
    if (activeBaseUsdcV4PaymentRef.current !== null) return
    if (activeBaseUsdcV5PaymentRef.current !== null) return
    if (activeWalletRequestRef.current?.pending) {
      void logBase("auto-resume-skipped", {
        source,
        reason: "wallet-request-pending",
        walletRequestKind: activeWalletRequestRef.current.kind,
      })
      refreshPendingState()
      return
    }
    if (isConnecting) return
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
    tryResumeBaseWalletConnectPayment(source)
  }, [address, connector, intentId, isConnected, isConnecting, refreshPendingState, selectedAsset, stopAutoResumeRetry, terminalStatus, tryResumeBaseWalletConnectPayment])
  useEffect(() => {
    refreshPendingState()
  }, [refreshPendingState])
  useEffect(() => {
    paymentSubmittedRef.current = false
    isSendingBaseTxRef.current = false
    prefetchedPaymentDataRef.current = null
    prefetchedProviderRef.current = null
    prefetchedTxRequestRef.current = null
    autoResumeAttemptedKeyRef.current = null
    setBaseUsdcV4Status("")
    activeBasePaymentAttemptRef.current = null
    activeBaseUsdcV4PaymentRef.current = null
    activeBaseUsdcV5PaymentRef.current = null
    activeWalletRequestRef.current = null
    connectedChainIdRef.current = null
    sessionSettleTriggerFiredRef.current = false
    setWalletRequestUiState("idle")
    setPendingWalletRequestKind(null)
    setWalletHandoffPending(false)
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
    if (terminalStatus) return
    if (!isConnected || !address) return
    if (!pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset)) return
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return
    if (activeBasePaymentAttemptRef.current !== null) return
    if (activeBaseUsdcV4PaymentRef.current !== null) return
    if (activeBaseUsdcV5PaymentRef.current !== null) return
    if (activeWalletRequestRef.current?.pending) return
    if (sessionSettleTriggerFiredRef.current) return
    sessionSettleTriggerFiredRef.current = true
    // Snapshot the chain ID at session-settle time so continueBasePayment can skip
    // switchChainAsync when the wallet just connected on Base. This ref is consumed
    // and cleared inside continueBasePayment before any chain switch check.
    if (chain?.id) connectedChainIdRef.current = chain.id
    if (!markAutomaticResumeAttempt("session-settle", address)) return
    stopAutoResumeRetry()
    void continueBasePayment(address)
  }, [address, chain?.id, continueBasePayment, intentId, isConnected, markAutomaticResumeAttempt, selectedAsset, stopAutoResumeRetry, terminalStatus])
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
          activeBasePaymentAttemptRef.current === null &&
          activeBaseUsdcV4PaymentRef.current === null &&
          activeBaseUsdcV5PaymentRef.current === null
        ) {
          if (!markAutomaticResumeAttempt("provider-event", eventAddress)) return
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
  }, [continueBasePayment, intentId, markAutomaticResumeAttempt, resumeFromWalletConnectProvider, selectedAsset, stopAutoResumeRetry, walletConnectConnector])
  // ── Render helpers ────────────────────────────────────────────────────────
  if (terminalStatus) {
    return (
      <div className="space-y-4">
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
          Base Network Payment
        </div>
        <PaymentStatusVisual status={terminalStatus} className="py-2" />
      </div>
    )
  }
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
  // ── Base UI execution state machine render ────────────────────────────────
  const currentStageNum = STAGE_NUM[execStage]
  const showUsdcAuthStep = selectedAsset === "USDC" && usedEmergencyAllowance
  function getStepStatus(doneAtNum: number, activeNums: number[]): "done" | "active" | "upcoming" {
    if (currentStageNum >= doneAtNum) return "done"
    if (activeNums.includes(currentStageNum)) return "active"
    return "upcoming"
  }
  const walletConnectedStatus = getStepStatus(
    STAGE_NUM.wallet_connected,
    [STAGE_NUM.asset_selected, STAGE_NUM.connecting_wallet]
  )
  const usdcAuthStatus = showUsdcAuthStep
    ? getStepStatus(STAGE_NUM.usdc_authorized, [STAGE_NUM.authorizing_usdc])
    : "done"
  const confirmPayStatus = getStepStatus(
    STAGE_NUM.payment_submitted,
    showUsdcAuthStep
      ? [STAGE_NUM.usdc_authorized, STAGE_NUM.confirm_payment, STAGE_NUM.submitting_payment]
      : [STAGE_NUM.wallet_connected, STAGE_NUM.preparing_payment, STAGE_NUM.confirm_payment, STAGE_NUM.submitting_payment]
  )
  const networkConfStatus = getStepStatus(
    STAGE_NUM.confirmed,
    [STAGE_NUM.payment_submitted, STAGE_NUM.detecting]
  )
  let contextMessage = ""
  if (execStage === "connecting_wallet" || execStage === "asset_selected") {
    contextMessage = "Opening wallet…"
  } else if (execStage === "wallet_connected" || execStage === "preparing_payment") {
    contextMessage = isResolvingAccount ? "Finalizing wallet connection…" : "Preparing payment…"
  } else if (execStage === "authorizing_usdc") {
    contextMessage = "Authorize USDC in your wallet"
  } else if (execStage === "usdc_authorized") {
    contextMessage = "Authorization confirmed. Preparing payment…"
  } else if (execStage === "confirm_payment") {
    contextMessage = "Confirm payment in your wallet"
  } else if (execStage === "submitting_payment") {
    contextMessage = "Confirming your payment…"
  } else if (execStage === "payment_submitted" || execStage === "detecting") {
    contextMessage = "Waiting for network confirmation…"
  }
  const walletRequestIsPending = walletRequestUiState === "opening_wallet" || walletRequestUiState === "awaiting_wallet" || walletRequestUiState === "request_sent"
  const activeWalletRequestKind = activeWalletRequestRef.current?.kind ?? pendingWalletRequestKind
  const showWalletPrompt =
    execStage === "confirm_payment" ||
    execStage === "authorizing_usdc" ||
    ((execStage === "connecting_wallet" || execStage === "asset_selected") && walletRequestIsPending)
  const showReturnHereHint =
    (execStage === "connecting_wallet" || execStage === "asset_selected") && !showWalletPrompt
  const walletRequestPrimaryCopy = activeWalletRequestKind === "connect"
    ? "Approve wallet connection"
    : activeWalletRequestKind === "usdc_approve"
      ? "Authorize USDC"
      : "Confirm payment in your wallet"
  const walletRequestDetailCopy = "Return here after approving if your wallet does not switch automatically."
  function renderStepIcon(status: "done" | "active" | "upcoming") {
    if (status === "done") {
      return (
        <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-green-500 shadow-sm shadow-green-500/20">
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l2.5 2.5 5.5-5" />
          </svg>
        </span>
      )
    }
    if (status === "active") {
      return (
        <span className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#0052FF] shadow-sm shadow-[#0052FF]/30">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
        </span>
      )
    }
    return (
      <span className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 ring-1 ring-gray-200">
        <span className="h-2 w-2 rounded-full bg-gray-300" />
      </span>
    )
  }
  function renderStep(label: string, status: "done" | "active" | "upcoming", subtext?: string) {
    const rowClasses = status === "done"
      ? "bg-green-50/80 ring-1 ring-green-100"
      : status === "active"
        ? "bg-[#0052FF]/5 ring-1 ring-[#0052FF]/20 shadow-sm shadow-[#0052FF]/10"
        : "bg-gray-50/80 ring-1 ring-gray-100"
    return (
      <div className={`flex items-start gap-3 rounded-2xl px-3.5 py-3 transition-all ${rowClasses}`}>
        <div className="mt-0.5">{renderStepIcon(status)}</div>
        <div className="min-w-0 flex-1">
          <span className={`text-sm leading-tight ${
            status === "done"
              ? "text-green-700 font-medium"
              : status === "active"
                ? "text-[#0052FF] font-semibold"
                : "text-gray-400 font-medium"
          }`}>
            {label}
          </span>
          {subtext && status === "active" ? (
            <p className="text-xs text-gray-600 mt-1 leading-snug">{subtext}</p>
          ) : null}
        </div>
      </div>
    )
  }
  const isExecutingStage = execStage !== "idle" && execStage !== "failed"
  if (isExecutingStage && execStage !== "retryable_error") {
    return (
      <div className="w-full space-y-3">
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center font-semibold">
          Base Network Payment
        </div>
        {!isIntentMode && amountDisplay}
        <div className="bg-white rounded-3xl mt-1 overflow-hidden shadow-sm ring-1 ring-gray-100">
          <div className="px-4 pt-4 pb-3 space-y-2.5">
            {renderStep(
              "Wallet connected",
              walletConnectedStatus,
              walletConnectedStatus === "active" ? "Approve wallet connection in your wallet" : undefined
            )}
            {showUsdcAuthStep ? renderStep(
              "Authorize USDC",
              usdcAuthStatus,
              usdcAuthStatus === "active" ? "Authorize USDC in your wallet, then return here" : undefined
            ) : null}
            {renderStep(
              "Confirm payment",
              confirmPayStatus,
              confirmPayStatus === "active" ? "Confirm payment in your wallet" : undefined
            )}
            {renderStep("Network confirmation", networkConfStatus)}
          </div>
          {contextMessage ? (
            <div className={`mx-4 mb-4 rounded-2xl px-4 py-3.5 ${showWalletPrompt ? "bg-[#0052FF]/5 ring-1 ring-[#0052FF]/15" : "bg-gray-50 ring-1 ring-gray-100"}`}>
              {showWalletPrompt ? (
                <div className="space-y-1.5">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[#0052FF]">
                    <span className="inline-block h-2 w-2 rounded-full bg-[#0052FF] animate-pulse flex-shrink-0" />
                    {walletRequestIsPending ? walletRequestPrimaryCopy : contextMessage}
                  </span>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {walletRequestIsPending ? walletRequestDetailCopy : "Return here after approving if your wallet does not switch automatically."}
                  </p>
                </div>
              ) : (
                <span className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-gray-400 border-t-transparent animate-spin flex-shrink-0" />
                  {contextMessage}
                </span>
              )}
              {showReturnHereHint ? (
                <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
                  Return here after approving if your wallet does not switch automatically.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {execStage !== "payment_submitted" && execStage !== "detecting" && execStage !== "confirmed" ? (
          <button
            type="button"
            className="w-full py-2 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
            onClick={() => {
              void logBase("cancel-click", { intentId: intentId || null, execStage })
              resetBasePaymentAttemptForRetry()
              onCancel?.()
            }}
          >
            Cancel payment
          </button>
        ) : null}
        {hasPendingBaseWcPayment && !isOpeningWallet && !isConnecting && !address ? (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-2">
            <p>Return to your wallet to continue, or reconnect if disconnected.</p>
            <Button
              fullWidth
              variant="secondary"
              onClick={() => {
                void logBase("reconnect-click", { intentId: intentId || null })
                if (!walletConnectConnector) return
                void enforceActivePaymentBeforeWalletConnect().then((isActivePayment) => {
                  if (!isActivePayment) return
                  return connectAsync({ connector: walletConnectConnector, chainId: base.id })
                })
                  .then((result) => {
                    if (!result) return
                    const addr = extractAddressFromConnectResult(result)
                    if (addr) {
                      setExecStageRef.current("wallet_connected")
                      void continueBasePayment(addr)
                    }
                  })
                  .catch(() => null)
              }}
            >
              Reconnect wallet
            </Button>
          </div>
        ) : null}
      </div>
    )
  }
  // Retryable error — standard error + retry button
  if (execStage === "retryable_error") {
    return (
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
          Base Network Payment
        </div>
        {!isIntentMode && amountDisplay}
        {localError ? (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {localError}
          </div>
        ) : null}
        <div className="space-y-2">
          {walletConnectConnector ? (
            <Button fullWidth onClick={() => startWalletConnectPayment()}>
              Try Again
            </Button>
          ) : (
            <div className="text-[11px] text-gray-500 text-center">
              WalletConnect is not configured.
            </div>
          )}
        </div>
        <button
          type="button"
          className="w-full py-2 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
          onClick={() => {
            void logBase("cancel-click", { intentId: intentId || null, execStage })
            resetBasePaymentAttemptForRetry()
            onCancel?.()
          }}
        >
          Cancel payment
        </button>
      </div>
    )
  }
  // Idle — standard pay button UI
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
                void enforceActivePaymentBeforeWalletConnect().then((isActivePayment) => {
                  if (!isActivePayment) return
                  return connectAsync({ connector: walletConnectConnector, chainId: base.id })
                })
                  .then((result) => {
                    if (!result) return
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
          {baseUsdcV4Status || "Preparing payment…"}
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
              Pay with {selectedAsset} on Base
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
