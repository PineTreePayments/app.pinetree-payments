"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAccount, useConnect, useSwitchChain, useWalletClient } from "wagmi"
import type { Connector } from "wagmi"
import { base } from "wagmi/chains"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
import { classifyWalletFamily, detectCapabilitiesFromProvider } from "@/lib/basePay/strategyOrchestrator"
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
  checkoutToken?: string
  onPaymentCreated?: (paymentId: string) => void
  onSuccess?: (txHash: string, paymentId: string) => void | Promise<void>
  onError?: (error: string) => void
  onExecutionStarted?: () => void
  onCancel?: () => void
}
type BaseUsdcStrategy =
  | "v7_eip3009_relayer"
  | "delegated_eoa_batch"
  | "allowance_two_step"
  | "allowance_direct"
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
type BaseMobileStep =
  | "idle"
  | "wallet_connecting"
  | "wallet_connected"
  | "usdc_authorization_ready"
  | "usdc_authorization_dispatching"
  | "usdc_authorization_in_wallet"
  | "usdc_authorization_submitted"
  | "payment_ready"
  | "payment_dispatching"
  | "payment_in_wallet"
  | "payment_submitted"
  | "network_confirmation"
  | "confirmed"
  | "failed"
  | "fallback_required"
type PaymentData = {
  paymentId: string
  paymentUrl: string
  baseUsdcStrategy?: BaseUsdcStrategy
  splitContract?: string
}
type BaseUsdcAuthorization = {
  validAfter: string
  validBefore: string
  nonce: string
}
type BaseV6UsdcPrepareResponse = {
  ok?: boolean
  unavailable?: boolean
  code?: string
  message?: string
  error?: string
  typedData?: unknown
  authorization?: BaseUsdcAuthorization
}
type BaseV6UsdcRelayResponse = {
  ok?: boolean
  status?: string
  unavailable?: boolean
  code?: string
  message?: string
  error?: string
  txHash?: string
}
type BaseV6UsdcAllowancePaymentResponse = {
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
  strategy?: "delegated_eoa_batch" | "delegated_v7_batch"
  chainId?: number
  calls?: DelegatedWalletCall[]
  callSummaries?: Array<{ kind: string; to: string; target: string; redacted: boolean }>
  requiredUsdcAmount?: string
  v5Contract?: string
  v7Contract?: string
  usdcToken?: string
  warnings?: string[]
  error?: string
}
type BaseV6StrategyResponse = {
  ok?: boolean
  paymentId?: string
  strategy?: "base_eth_direct" | "usdc_delegated_batch" | "usdc_eip3009_relayer" | "usdc_allowance_direct" | "usdc_allowance_two_step"
  fallbackStrategy?: "usdc_eip3009_relayer" | "usdc_allowance_direct" | "usdc_allowance_two_step" | null
  asset?: "ETH" | "USDC"
  allowanceSufficient?: boolean
  relayerAvailable?: boolean
  relayerReason?: string
  delegatedAvailable?: boolean
  requiredUsdcAmount?: string
  currentAllowance?: string
  walletFamily?: string
  supportsTypedData?: boolean
  supportsSendCalls?: boolean
  expectedWalletPrompts?: number
  customerFacingNotice?: string
  debugSummary?: string
  error?: string
  unavailable?: boolean
  code?: string
  message?: string
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
  modal?: {
    close?: () => unknown
    closeModal?: () => unknown
  }
}
type SettledWalletConnectSession = {
  provider: WalletConnectProvider
  address: string
  chainId: number | null
  peerName: string | null
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
const BASE_WC_AUTO_RESUME_RETRY_MS = 500
const BASE_WC_AUTO_RESUME_RETRY_TIMEOUT_MS = 10_000
const BASE_WC_SETTLE_TIMEOUT_MS = 8_000
const BASE_WC_SETTLE_POLL_MS = 250
const BASE_WC_POST_ACCOUNT_SETTLE_MS = 0
const BASE_ETH_TX_REQUEST_TIMEOUT_MS = 90_000
const BASE_ETH_TX_TIMEOUT_MESSAGE = "Transaction approval was not completed. Retry payment approval to try again."
const BASE_USDC_TX_REQUEST_TIMEOUT_MS = 90_000
const BASE_USDC_SIGN_TIMEOUT_MESSAGE = "USDC authorization signature was not completed. Retry USDC authorization to try again."
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Base USDC is temporarily unavailable because current network costs are above PineTree’s limit. Please try again shortly or choose another payment method."
const TERMINAL_PAYMENT_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])
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
function logBasePay(event: string, payload: Record<string, unknown> = {}): void {
  console.info(`[BasePay] ${event}`, payload)
}
function logBaseV6(event: string, payload: Record<string, unknown> = {}): void {
  const allowed = new Set([
    "paymentId",
    "selectedAsset",
    "step",
    "actionKind",
    "strategy",
    "hasAccount",
    "chainId",
    "hasTxHash",
    "requestStarted",
    "providerRequestStarted",
    "method",
    "reason",
    "source",
    "documentVisibility",
    "fallbackReason",
    "errorCode",
    "errorMessage",
    "elapsedConnectionToRequestMs",
    "elapsedReturnToRequestMs",
    "elapsedApprovalToFinalRequestMs",
    "elapsedMs",
    "fallbackStrategy",
    "relayerAvailable",
    "allowanceSufficient",
    "requiredUsdcAmount",
    "currentAllowance",
    "walletFamily",
    "supportsTypedData",
    "supportsSendCalls",
  ])
  const safePayload = Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.has(key)))
  console.info(`[BaseV6] ${event}`, safePayload)
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
  rejected: boolean
  timedOut: boolean
  transactionPromptStarted: boolean
}): "user-rejected-transaction" | "transaction-timeout" | null {
  if (input.selectedAsset !== "ETH") return null
  if (!input.transactionPromptStarted) return null
  if (input.rejected) return "user-rejected-transaction"
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
function closeWalletConnectSelectionModal(provider?: WalletConnectProvider | null): void {
  let closed = false
  try {
    const modal = provider?.modal
    if (typeof modal?.close === "function") {
      logBasePay("appkit_modal_close_attempted", { method: "provider.modal.close" })
      modal.close()
      closed = true
      logBasePay("appkit_modal_closed", { method: "provider.modal.close" })
      return
    }
    if (typeof modal?.closeModal === "function") {
      logBasePay("appkit_modal_close_attempted", { method: "provider.modal.closeModal" })
      modal.closeModal()
      closed = true
      logBasePay("appkit_modal_closed", { method: "provider.modal.closeModal" })
      return
    }
  } catch {
    // Best-effort only; the payment state machine remains authoritative.
  }

  try {
    const modalElement = document.querySelector("w3m-modal, appkit-modal") as unknown as {
      close?: () => unknown
    } | null
    logBasePay("appkit_modal_close_attempted", { method: "dom-modal-close", found: Boolean(modalElement) })
    modalElement?.close?.()
    closed = Boolean(modalElement)
    if (closed) logBasePay("appkit_modal_closed", { method: "dom-modal-close" })
  } catch {
    // Best-effort only.
  }
}
function tryOpenWalletNativeUri(provider: WalletConnectProvider): void {
  try {
    const source = provider as {
      session?: {
        peer?: {
          metadata?: {
            redirect?: { native?: string }
          }
        }
      }
    }
    const uri = source.session?.peer?.metadata?.redirect?.native
    if (typeof uri === "string" && uri.length > 0 && !uri.startsWith("https://") && !uri.startsWith("http://")) {
      logBasePay("wallet_open_prompt_triggered", { reason: "walletconnect-redirect" })
      console.info("[BASE TRACE] wallet_foreground_attempted", { uri: uri.split("?")[0] })
      window.location.href = uri
    }
  } catch {
    // Best-effort; ignore errors.
  }
}
function requireBaseUsdcTypedData(typedData: unknown, fromAddress: string): Eip712TypedData {
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
  // Some wallets return the txHash as a plain string from wallet_sendCalls
  if (typeof result === "string") return maybeHexTransactionHash(result)
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
  // Some wallets return the callId/bundleId as a plain string from wallet_sendCalls
  if (typeof result === "string") return result.trim()
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
  if (Array.isArray(source.receipts) && source.receipts.length > 0) {
    // Iterate in reverse: in a [approve, payment] batch the last receipt is the payment tx
    for (let i = source.receipts.length - 1; i >= 0; i--) {
      const receipt = source.receipts[i]
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
  paymentId?: string
  actionKind?: WalletRequestKind
  onProviderRequestStarted?: () => void
  debugTimings?: {
    source?: string
    selectedAsset?: BaseAsset
    elapsedConnectionToRequestMs?: number | null
    elapsedReturnToRequestMs?: number | null
    elapsedApprovalToFinalRequestMs?: number | null
  }
}): Promise<string> {
  const actionKind = input.actionKind || "eth_payment"
  const startedAt = Date.now()
  const params = [
    {
      from: input.fromAddress,
      to: input.txRequest.to,
      value: input.txRequest.value,
      data: input.txRequest.data,
      chainId: decimalOrHexToHex(String(input.txRequest.chainId)),
    },
  ]
  const requestStartPayload = {
    paymentId: input.paymentId || "",
    selectedAsset: input.debugTimings?.selectedAsset,
    actionKind,
    method: "eth_sendTransaction",
    requestStarted: true,
    providerRequestStarted: true,
    chainId: input.txRequest.chainId,
    source: input.debugTimings?.source,
    documentVisibility: typeof document !== "undefined" ? document.visibilityState : undefined,
    elapsedConnectionToRequestMs: input.debugTimings?.elapsedConnectionToRequestMs ?? null,
    elapsedReturnToRequestMs: input.debugTimings?.elapsedReturnToRequestMs ?? null,
    elapsedApprovalToFinalRequestMs: input.debugTimings?.elapsedApprovalToFinalRequestMs ?? null,
  }
  logBasePay("provider_request_start", { method: "eth_sendTransaction", actionKind, hasParams: true })
  logBaseV6("provider_request_start", requestStartPayload)
  logBaseV6(actionKind === "eth_payment" ? "eth_provider_request_start" : actionKind === "usdc_approve" ? "usdc_approval_request_start" : "usdc_final_payment_request_start", requestStartPayload)
  let rawTxHash: unknown
  try {
    input.onProviderRequestStarted?.()
    rawTxHash = await input.provider.request({
      method: "eth_sendTransaction",
      params,
    })
  } catch (error) {
    const details = extractErrorDetails(error)
    logBasePay("provider_request_rejected", {
      actionKind,
      code: details.code ?? null,
      message: details.message ?? "",
    })
    logBaseV6("error", {
      paymentId: input.paymentId || "",
      actionKind,
      method: "eth_sendTransaction",
      requestStarted: true,
      providerRequestStarted: true,
      reason: String(details.message || details.code || "provider_request_failed"),
      errorCode: details.code ?? null,
      errorMessage: String(details.message || ""),
      elapsedMs: Date.now() - startedAt,
    })
    throw error
  }
  const txHash = maybeHexTransactionHash(rawTxHash)
  logBasePay("provider_request_resolved", { actionKind, hasTxHash: Boolean(txHash) })
  logBaseV6(actionKind === "eth_payment" ? "eth_provider_request_resolved" : actionKind === "usdc_approve" ? "usdc_approval_request_resolved" : "usdc_final_payment_request_resolved", {
    paymentId: input.paymentId || "",
    selectedAsset: input.debugTimings?.selectedAsset,
    actionKind,
    method: "eth_sendTransaction",
    hasTxHash: Boolean(txHash),
    source: input.debugTimings?.source,
    elapsedMs: Date.now() - startedAt,
  })
  if (!txHash) {
    logBasePay("provider_request_no_response", { actionKind, reason: "no-tx-hash-returned" })
    logBaseV6("error", {
      paymentId: input.paymentId || "",
      actionKind,
      method: "eth_sendTransaction",
      hasTxHash: false,
      reason: "no-tx-hash-returned",
      elapsedMs: Date.now() - startedAt,
    })
    throw new Error("Wallet did not return a transaction hash.")
  }
  logBasePay("tx_hash_captured", { actionKind, hasTxHash: true })
  logBaseV6(actionKind === "eth_payment" ? "eth_tx_hash_captured" : actionKind === "usdc_approve" ? "usdc_approval_tx_hash_captured" : "usdc_final_payment_tx_hash_captured", {
    paymentId: input.paymentId || "",
    selectedAsset: input.debugTimings?.selectedAsset,
    actionKind,
    method: "eth_sendTransaction",
    hasTxHash: true,
    source: input.debugTimings?.source,
    elapsedMs: Date.now() - startedAt,
  })
  return txHash
}
async function sendWalletConnectTransactionWithTimeout(input: {
  provider: WalletConnectProvider
  fromAddress: string
  txRequest: EvmTransactionRequest
  paymentId?: string
  timeoutMs: number
  timeoutMessage: string
  actionKind?: WalletRequestKind
  onProviderRequestStarted?: () => void
  debugTimings?: {
    source?: string
    selectedAsset?: BaseAsset
    elapsedConnectionToRequestMs?: number | null
    elapsedReturnToRequestMs?: number | null
    elapsedApprovalToFinalRequestMs?: number | null
  }
}): Promise<string> {
  let txTimeoutHandle: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      sendWalletConnectTransaction({
        provider: input.provider,
        fromAddress: input.fromAddress,
        txRequest: input.txRequest,
        paymentId: input.paymentId,
        actionKind: input.actionKind,
        onProviderRequestStarted: input.onProviderRequestStarted,
        debugTimings: input.debugTimings,
      }),
      new Promise<never>((_, reject) => {
        txTimeoutHandle = setTimeout(
          () => reject(new Error(input.timeoutMessage)),
          input.timeoutMs
        )
      }),
    ])
  } catch (error) {
    if (extractErrorMessage(error) === input.timeoutMessage) {
      logBasePay("provider_request_timeout_or_no_result", { actionKind: input.actionKind || "eth_payment" })
    }
    throw error
  } finally {
    if (txTimeoutHandle !== null) clearTimeout(txTimeoutHandle)
  }
}
function resolveBaseUsdcStrategyFromResponse(result: {
  baseUsdcStrategy?: BaseUsdcStrategy
  metadata?: { split?: { baseUsdcStrategy?: unknown } }
}): BaseUsdcStrategy | undefined {
  const strategy = String(
    result.metadata?.split?.baseUsdcStrategy || result.baseUsdcStrategy || ""
  ).trim()
  if (
    strategy === "v7_eip3009_relayer" ||
    strategy === "delegated_eoa_batch" ||
    strategy === "allowance_two_step" ||
    strategy === "allowance_direct"
  ) {
    return strategy as BaseUsdcStrategy
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
  checkoutToken,
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
  const [basePayStatus, setBasePayStatus] = useState<string>("")
  const [connectedPeerName, setConnectedPeerName] = useState<string | null>(null)
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
  const activeBaseV6PaymentRef = useRef<string | null>(null)
  const activeBasePaymentAttemptRef = useRef<string | null>(null)
  const triggerBaseAutoResumeRef = useRef<((source: string) => void) | null>(null)
  const usdcFinalPaymentTxRef = useRef<EvmTransactionRequest | null>(null)
  const usdcFinalPaymentIdRef = useRef<string | null>(null)
  const walletConnectionApprovedAtRef = useRef<number | null>(null)
  const browserReturnedAtRef = useRef<number | null>(null)
  const browserBackgroundedAtRef = useRef<number | null>(null)
  const usdcApprovalTxHashAtRef = useRef<number | null>(null)
  const pendingEthPaymentTxRef = useRef<EvmTransactionRequest | null>(null)
  const pendingUsdcApproveTxRef = useRef<EvmTransactionRequest | null>(null)
  const pendingActionKindRef = useRef<WalletRequestKind | null>(null)
  const pendingActionPaymentIdRef = useRef<string | null>(null)
  const pendingActionInFlightRef = useRef(false)
  const dispatchPendingWalletActionRef = useRef<((source?: string) => Promise<boolean>) | null>(null)
  const autoWalletActionAttemptedKeyRef = useRef<Set<string>>(new Set())
  const autoWalletActionDispatchingKeyRef = useRef<Set<string>>(new Set())
  // Tracks a live wallet request (connect / sign / send) so we know whether
  // the user is currently in-wallet. While pending=true we never show rejection UI.
  const activeWalletRequestRef = useRef<ActiveWalletRequest | null>(null)
  const [walletHandoffPending, setWalletHandoffPending] = useState(false)
  const [walletRequestUiState, setWalletRequestUiState] = useState<WalletRequestUiState>("idle")
  const [pendingWalletRequestKind, setPendingWalletRequestKind] = useState<WalletRequestKind | null>(null)
  const [pendingWalletActionKind, setPendingWalletActionKind] = useState<WalletRequestKind | null>(null)
  const [pendingWalletActionReady, setPendingWalletActionReady] = useState(false)
  const [pendingWalletActionInFlight, setPendingWalletActionInFlight] = useState(false)
  // ── Base UI execution state machine ────────────────────────────────────────
  const [execStage, setExecStageRaw] = useState<BaseExecutionStage>("idle")
  const [baseMobileStep, setBaseMobileStepRaw] = useState<BaseMobileStep>("idle")
  const [usedEmergencyAllowance, setUsedEmergencyAllowance] = useState(false)
  // Tracks the brief address-resolution wait after WalletConnect session settles
  const [isResolvingAccount, setIsResolvingAccount] = useState(false)
  // Mirrors wagmi address so async callbacks can read latest value without closure staleness
  const addressRef = useRef<string | undefined>(undefined)
  addressRef.current = address
  const execStageRef = useRef<BaseExecutionStage>("idle")
  const baseMobileStepRef = useRef<BaseMobileStep>("idle")
  // Stable ref so useCallbacks with [] deps always call the latest setter logic
  const setExecStageRef = useRef<(stage: BaseExecutionStage, opts?: { allowance?: boolean }) => void>(() => {})
  const setBaseMobileStepRef = useRef<(step: BaseMobileStep) => void>(() => {})
  setBaseMobileStepRef.current = (step) => {
    const prev = baseMobileStepRef.current
    if (prev === step) return
    baseMobileStepRef.current = step
    setBaseMobileStepRaw(step)
    void logBase("mobile-step-change", {
      from: prev,
      to: step,
      execStage: execStageRef.current,
      pendingAction: pendingActionKindRef.current,
      hasAddress: Boolean(addressRef.current),
    })
    logBaseV6("lifecycle", {
      paymentId: pendingActionPaymentIdRef.current || activeBaseV6PaymentRef.current || "",
      selectedAsset,
      step,
      actionKind: pendingActionKindRef.current || activeWalletRequestRef.current?.kind || null,
      hasAccount: Boolean(addressRef.current),
      chainId: connectedChainIdRef.current || chain?.id || null,
      hasTxHash: paymentSubmittedRef.current,
    })
  }
  setExecStageRef.current = (stage, opts) => {
    const prev = execStageRef.current
    if (prev === stage) return
    console.log("[BASE UI] stage-change", { from: prev, to: stage, asset: selectedAsset, intentId: intentId ?? null })
    execStageRef.current = stage
    setExecStageRaw(stage)
    if (opts?.allowance) setUsedEmergencyAllowance(true)
    const mappedStep: Partial<Record<BaseExecutionStage, BaseMobileStep>> = {
      idle: "idle",
      asset_selected: "wallet_connecting",
      connecting_wallet: "wallet_connecting",
      wallet_connected: "wallet_connected",
      payment_submitted: "payment_submitted",
      detecting: "network_confirmation",
      confirmed: "confirmed",
      retryable_error: "failed",
      failed: "failed",
    }
    const nextStep = mappedStep[stage]
    if (nextStep) setBaseMobileStepRef.current(nextStep)
    try {
      sessionStorage.setItem(`pinetree_base_exec_${intentId ?? "direct"}_${selectedAsset}`, stage)
    } catch {}
  }
  const setIsResolvingAccountRef = useRef<(v: boolean) => void>(() => {})
  setIsResolvingAccountRef.current = setIsResolvingAccount
  const getProviderRequestDebugTimings = useCallback((actionKind: WalletRequestKind, source?: string) => {
    const now = Date.now()
    return {
      source,
      selectedAsset,
      elapsedConnectionToRequestMs: walletConnectionApprovedAtRef.current === null
        ? null
        : now - walletConnectionApprovedAtRef.current,
      elapsedReturnToRequestMs: browserReturnedAtRef.current === null
        ? null
        : now - browserReturnedAtRef.current,
      elapsedApprovalToFinalRequestMs: actionKind === "usdc_payment" && usdcApprovalTxHashAtRef.current !== null
        ? now - usdcApprovalTxHashAtRef.current
        : null,
    }
  }, [selectedAsset])
  const markWalletConnectionApproved = useCallback((source: string, payload: Record<string, unknown> = {}) => {
    if (walletConnectionApprovedAtRef.current === null) {
      walletConnectionApprovedAtRef.current = Date.now()
    }
    logBaseV6("wallet_connection_approved", {
      selectedAsset,
      source,
      hasAccount: Boolean(addressRef.current),
      chainId: connectedChainIdRef.current || chain?.id || null,
      documentVisibility: typeof document !== "undefined" ? document.visibilityState : undefined,
      ...payload,
    })
  }, [chain?.id, selectedAsset])
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
  const waitForWalletConnectSettlement = useCallback(async (source: string): Promise<SettledWalletConnectSession | null> => {
    if (!walletConnectConnector) return null
    const startedAt = Date.now()
    let lastReason = ""

    while (Date.now() - startedAt <= BASE_WC_SETTLE_TIMEOUT_MS) {
      if (paymentSubmittedRef.current) return null
      const activeRequest = activeWalletRequestRef.current
      try {
        const provider = await getWalletConnectProvider(walletConnectConnector)
        logBasePay("provider_ready", { ready: true, source })
        const accounts = await provider.request({ method: "eth_accounts", params: [] })
        const resolvedAddress = extractAddressFromConnectResult(accounts)
        let providerChainId: number | null = null
        try {
          const chainIdResult = await provider.request({ method: "eth_chainId", params: [] })
          providerChainId = Number(BigInt(String(chainIdResult || "0x0")))
        } catch {
          providerChainId = null
        }

        if (/^0x[a-fA-F0-9]{40}$/.test(resolvedAddress) && (!providerChainId || providerChainId === base.id)) {
          if (BASE_WC_POST_ACCOUNT_SETTLE_MS > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, BASE_WC_POST_ACCOUNT_SETTLE_MS))
          }
          addressRef.current = resolvedAddress
          if (providerChainId) connectedChainIdRef.current = providerChainId
          if (activeRequest?.pending && activeRequest.kind === "connect") {
            markWalletConnectionApproved(source, {
              hasAccount: true,
              chainId: providerChainId,
            })
          }
          if (activeRequest?.pending && activeRequest.kind === "connect") {
            closeWalletConnectSelectionModal(provider)
            activeWalletRequestRef.current = null
            logBasePay("stale_lock_cleared", { lockName: "activeWalletRequestRef:connect" })
            setWalletRequestUiState("request_resolved")
            setPendingWalletRequestKind(null)
            setWalletHandoffPending(false)
            setIsOpeningWallet(false)
          }
          logBasePay("connection_settled", { source })
          logBasePay("accounts_detected", { hasAccount: true })
          logBasePay("chain_detected", { chainId: providerChainId })
          logBaseV6("session_ready_detected", {
            selectedAsset,
            source,
            hasAccount: true,
            chainId: providerChainId,
            documentVisibility: typeof document !== "undefined" ? document.visibilityState : undefined,
          })
          await logBase("walletconnect-connection-settled", {
            source,
            hasAddress: true,
            chainId: providerChainId,
            clearedConnectRequest: activeRequest?.kind === "connect",
          })
          return {
            provider,
            address: resolvedAddress,
            chainId: providerChainId,
            peerName: getWalletConnectPeerName(provider),
          }
        }

        lastReason = resolvedAddress
          ? "chain-not-ready"
          : activeRequest?.pending && activeRequest.kind === "connect"
            ? "connection-request-pending"
            : "no-provider-account"
      } catch (error) {
        logBasePay("provider_ready", { ready: false, source })
        lastReason = extractErrorMessage(error) || "provider-unavailable"
      }

      await logBase("walletconnect-connection-pending", { source, reason: lastReason })
      await new Promise<void>((resolve) => setTimeout(resolve, BASE_WC_SETTLE_POLL_MS))
    }

    await logBase("walletconnect-settle-timeout", { source, reason: lastReason })
    return null
  }, [markWalletConnectionApproved, selectedAsset, walletConnectConnector])
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
  const syncPendingWalletActionState = useCallback((input?: {
    kind?: WalletRequestKind | null
    paymentId?: string | null
    ready?: boolean
    inFlight?: boolean
  }) => {
    if (Object.prototype.hasOwnProperty.call(input || {}, "kind")) {
      pendingActionKindRef.current = input?.kind ?? null
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, "paymentId")) {
      pendingActionPaymentIdRef.current = input?.paymentId ?? null
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, "inFlight")) {
      pendingActionInFlightRef.current = Boolean(input?.inFlight)
    }
    setPendingWalletActionKind(pendingActionKindRef.current)
    setPendingWalletActionReady(Boolean(input?.ready) && Boolean(pendingActionKindRef.current))
    setPendingWalletActionInFlight(pendingActionInFlightRef.current)
  }, [])
  const clearPendingWalletAction = useCallback((opts?: { clearTransactions?: boolean }) => {
    pendingActionKindRef.current = null
    pendingActionPaymentIdRef.current = null
    pendingActionInFlightRef.current = false
    if (opts?.clearTransactions !== false) {
      pendingEthPaymentTxRef.current = null
      pendingUsdcApproveTxRef.current = null
      usdcFinalPaymentTxRef.current = null
      usdcFinalPaymentIdRef.current = null
      usdcApprovalTxHashAtRef.current = null
    }
    setPendingWalletActionKind(null)
    setPendingWalletActionReady(false)
    setPendingWalletActionInFlight(false)
  }, [])
  const queuePendingWalletAction = useCallback((input: {
    kind: WalletRequestKind
    paymentId: string
    ready?: boolean
  }) => {
    pendingActionKindRef.current = input.kind
    pendingActionPaymentIdRef.current = input.paymentId
    pendingActionInFlightRef.current = false
    setPendingWalletActionKind(input.kind)
    setPendingWalletActionReady(input.ready !== false)
    setPendingWalletActionInFlight(false)
    setWalletHandoffPending(false)
    preservePendingWalletRequestUi(input.kind)
    logBasePay("queue_next_request", { actionKind: input.kind })
    if (input.ready !== false) {
      if (input.kind === "usdc_approve") {
        setBaseMobileStepRef.current("usdc_authorization_ready")
      } else if (input.kind === "eth_payment" || input.kind === "usdc_payment") {
        setBaseMobileStepRef.current("payment_ready")
      }
    }
  }, [preservePendingWalletRequestUi])
  const recheckUsdcAllowanceAndQueueFinalPayment = useCallback(async (input: {
    paymentId: string
    fromAddress: string
    source: string
    maxWaitMs?: number
  }): Promise<boolean> => {
    const maxWaitMs = input.maxWaitMs ?? 120_000
    const pollIntervalMs = 2_000
    const pollStartedAt = Date.now()
    let allowanceSufficient = false

    logBaseV6("usdc_allowance_recheck_start", {
      paymentId: input.paymentId,
      selectedAsset,
      actionKind: "usdc_approve",
      hasAccount: Boolean(input.fromAddress),
    })

    while (!allowanceSufficient && Date.now() - pollStartedAt < maxWaitMs) {
      try {
        const checkRes = await fetch(
          `/api/payments/${encodeURIComponent(input.paymentId)}/base-v7/allowance-check`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payerAddress: input.fromAddress }),
          }
        )
        const checkData = (await checkRes.json()) as { ok?: boolean; sufficient?: boolean }
        allowanceSufficient = Boolean(checkData.ok && checkData.sufficient)
        logBaseV6("usdc_allowance_recheck_result", {
          paymentId: input.paymentId,
          selectedAsset,
          actionKind: "usdc_approve",
          allowanceSufficient,
        })
        if (allowanceSufficient) {
          logBaseV6("usdc_allowance_sufficient", {
            paymentId: input.paymentId,
            selectedAsset,
            actionKind: "usdc_approve",
            allowanceSufficient: true,
            source: input.source,
          })
        }
      } catch (error) {
        logBaseV6("usdc_allowance_recheck_result", {
          paymentId: input.paymentId,
          selectedAsset,
          actionKind: "usdc_approve",
          allowanceSufficient: false,
          reason: extractErrorMessage(error) || "allowance-recheck-error",
        })
      }
      if (allowanceSufficient) break
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    if (!allowanceSufficient) return false

    if (!usdcFinalPaymentTxRef.current || usdcFinalPaymentIdRef.current !== input.paymentId) {
      logBaseV6("usdc_final_payment_build_start", {
        paymentId: input.paymentId,
        selectedAsset,
        actionKind: "usdc_payment",
        hasAccount: Boolean(input.fromAddress),
      })
      const buildRes = await fetch(
        `/api/payments/${encodeURIComponent(input.paymentId)}/base-v7/build-allowance-payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payerAddress: input.fromAddress }),
        }
      )
      const buildData = (await buildRes.json()) as BaseV6UsdcAllowancePaymentResponse
      if (!buildRes.ok || !buildData.ok || !buildData.paymentTx) {
        throw new Error(buildData.error || "Failed to build final Base USDC payment")
      }
      usdcFinalPaymentTxRef.current = buildData.paymentTx
      usdcFinalPaymentIdRef.current = input.paymentId
    }

    setExecStageRef.current("usdc_authorized")
    setBasePayStatus("Sending final payment approval.")
    pendingUsdcApproveTxRef.current = null
    queuePendingWalletAction({ kind: "usdc_payment", paymentId: input.paymentId, ready: true })
    setExecStageRef.current("confirm_payment")
    setBaseMobileStepRef.current("payment_ready")
    logBaseV6("usdc_final_payment_ready", {
      paymentId: input.paymentId,
      selectedAsset,
      actionKind: "usdc_payment",
      reason: input.source,
    })
    return true
  }, [queuePendingWalletAction, selectedAsset])
  const dispatchPendingWalletAction = useCallback(async (source = "manual"): Promise<boolean> => {
    const kind = pendingActionKindRef.current
    const paymentId = pendingActionPaymentIdRef.current
    if (!kind || !paymentId || pendingActionInFlightRef.current || paymentSubmittedRef.current) return false
    if (kind !== "eth_payment" && kind !== "usdc_approve" && kind !== "usdc_payment") return false
    if (!walletConnectConnector) {
      setLocalError("WalletConnect is not configured.")
      setBaseMobileStepRef.current("fallback_required")
      return false
    }
    const settledSession = await waitForWalletConnectSettlement(`pending-action:${source}`)
    if (!settledSession || !/^0x[a-fA-F0-9]{40}$/.test(settledSession.address)) {
      await logBase("pending-wallet-action-blocked", {
        source,
        kind,
        paymentId,
        reason: "connection-not-settled",
      })
      setLocalError("Wallet disconnected. Reconnect to continue.")
      setPendingWalletActionReady(true)
      setBaseMobileStepRef.current("fallback_required")
      logBasePay("fallback_required", { actionKind: kind, reason: "connection-not-settled" })
      return false
    }
    const provider = settledSession.provider
    const fromAddress = settledSession.address
    const txRequest = kind === "eth_payment"
      ? pendingEthPaymentTxRef.current
      : kind === "usdc_approve"
        ? pendingUsdcApproveTxRef.current
        : usdcFinalPaymentTxRef.current
    if (!txRequest) {
      setLocalError("Payment confirmation details are no longer available. Tap Try Again to restart.")
      setExecStageRef.current("retryable_error")
      setBaseMobileStepRef.current("failed")
      logBasePay("fallback_required", { actionKind: kind, reason: "missing-transaction-request" })
      clearPendingWalletAction()
      return false
    }

    pendingActionInFlightRef.current = true
    setPendingWalletActionInFlight(true)
    setPendingWalletActionReady(false)
    setLocalError("")
    setIsOpeningWallet(true)
    setBaseMobileStepRef.current(kind === "usdc_approve" ? "usdc_authorization_dispatching" : "payment_dispatching")
    const stage = kind === "usdc_approve" ? "authorizing_usdc" : "confirm_payment"
    setExecStageRef.current(stage, kind === "usdc_approve" ? { allowance: true } : undefined)
    setBasePayStatus(
      kind === "usdc_approve"
        ? "Approve USDC authorization in your wallet."
        : kind === "usdc_payment"
          ? "Approve final payment in your wallet."
          : "Approve in your wallet..."
    )

    const peerName = settledSession.peerName

    beginWalletRequest({ kind, walletName: peerName })
    const attemptKey = `${paymentId}:${selectedAsset}:${kind}`
    if (source.startsWith("auto-")) {
      if (autoWalletActionAttemptedKeyRef.current.has(attemptKey)) {
        activeWalletRequestRef.current = null
        pendingActionInFlightRef.current = false
        setPendingWalletActionInFlight(false)
        setPendingWalletActionReady(true)
        setIsOpeningWallet(false)
        setBaseMobileStepRef.current("fallback_required")
        logBasePay("fallback_required", { actionKind: kind, reason: "auto-dispatch-already-attempted" })
        logBaseV6("fallback_required", { paymentId, actionKind: kind, reason: "auto-dispatch-already-attempted" })
        return false
      }
    }
    autoWalletActionDispatchingKeyRef.current.delete(attemptKey)
    logBasePay("auto_dispatch_start", { actionKind: kind, attemptKey })
    await logBase("pending-wallet-action-dispatch", { source, kind, paymentId, chainId: settledSession.chainId })
    try {
      closeWalletConnectSelectionModal(provider)
      let providerRequestStarted = false
      const txPromise = sendWalletConnectTransactionWithTimeout({
        provider,
        fromAddress,
        txRequest,
        paymentId,
        timeoutMs: kind === "eth_payment" ? BASE_ETH_TX_REQUEST_TIMEOUT_MS : BASE_USDC_TX_REQUEST_TIMEOUT_MS,
        timeoutMessage: kind === "eth_payment"
          ? BASE_ETH_TX_TIMEOUT_MESSAGE
          : kind === "usdc_approve"
            ? "USDC authorization approval was not completed. Retry USDC authorization to try again."
            : "Payment transaction was not completed. Retry payment approval to try again.",
        actionKind: kind,
        onProviderRequestStarted: () => {
          providerRequestStarted = true
          if (source.startsWith("auto-")) {
            autoWalletActionAttemptedKeyRef.current.add(attemptKey)
          }
        },
        debugTimings: getProviderRequestDebugTimings(kind, source),
      })
      if (source.startsWith("auto-") && providerRequestStarted) {
        autoWalletActionAttemptedKeyRef.current.add(attemptKey)
      }
      setBaseMobileStepRef.current(kind === "usdc_approve" ? "usdc_authorization_in_wallet" : "payment_in_wallet")
      // Only fire the native wallet deep-link for explicit user-triggered retries.
      // During auto-dispatch the WalletConnect relay already queues the request at
      // the wallet via WebSocket / push notification. Auto-firing the native URI
      // creates an OS-level "Open in [Wallet]?" sheet on top of the PineTree status
      // screen the moment the user returns from approving the connection — the source
      // of the observed browser→wallet→browser→wallet ping-pong overlay.
      if (!source.startsWith("auto-")) {
        logBasePay("wallet_open_prompt_triggered", { actionKind: kind, reason: "manual-retry-dispatch" })
        tryOpenWalletNativeUri(provider)
      }
      const txHash = await txPromise
      resolveWalletRequest()
      closeWalletConnectSelectionModal(provider)
      pendingActionInFlightRef.current = false
      setPendingWalletActionInFlight(false)
      setPendingWalletActionReady(false)
      setIsOpeningWallet(false)
      await logBase("pending-wallet-action-submitted", {
        source,
        kind,
        paymentId,
        txHashPrefix: txHash.slice(0, 10),
      })

      if (kind === "usdc_approve") {
        usdcApprovalTxHashAtRef.current = Date.now()
        pendingUsdcApproveTxRef.current = null
        setBaseMobileStepRef.current("usdc_authorization_submitted")
        setBasePayStatus("Sending final payment approval.")
        void logBase("usdc-allowance-wait-started", { paymentId, via: "pending-wallet-action" })
        const allowanceSufficient = await recheckUsdcAllowanceAndQueueFinalPayment({
          paymentId,
          fromAddress,
          source: "approval-resolved",
        })
        if (!allowanceSufficient) {
          throw new Error("USDC allowance was not confirmed in time. Retry USDC authorization or tap Try Again to restart.")
        }
        await logBase("usdc-allowance-confirmed", { paymentId, via: "pending-wallet-action" })
        window.setTimeout(() => {
          void dispatchPendingWalletActionRef.current?.("auto-usdc-final-after-approval")
        }, 0)
        return true
      }

      clearPendingWalletAction()
      paymentSubmittedRef.current = true
      activeBasePaymentAttemptRef.current = null
      setExecStageRef.current("payment_submitted")
      setBaseMobileStepRef.current("payment_submitted")
      console.log("[BASE UI] final-tx-submitted", { paymentId, txHashPrefix: txHash.slice(0, 10), asset: kind === "eth_payment" ? "ETH" : "USDC" })
      void logBase(kind === "eth_payment" ? "eth-payment-submitted" : "usdc-payment-submitted", { paymentId, txHashPrefix: txHash.slice(0, 10) })
      void logBase("detect-start", { paymentId, txHashPrefix: txHash.slice(0, 10) })
      logBasePay("network_confirmation_entered", { hasTxHash: true, actionKind: kind })
      logBaseV6("network_confirmation_entered", { paymentId, selectedAsset, actionKind: kind, hasTxHash: true })
      logBasePay("waiting_for_payment_entered", { hasTxHash: true, actionKind: kind, step: "network_confirmation" })
      setExecStageRef.current("detecting")
      setBaseMobileStepRef.current("network_confirmation")
      await onSuccess?.(txHash, paymentId)
      void logBase("detect-success", { paymentId })
      clearPendingBaseWalletConnectPayment()
      setHasPendingBaseWcPayment(false)
      if (intentId) {
        window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
      }
      return true
    } catch (dispatchErr) {
      const message = extractErrorMessage(dispatchErr)
      const rejected = isActualUserRejectedError(dispatchErr, message)
      activeWalletRequestRef.current = null
      pendingActionInFlightRef.current = false
      setPendingWalletActionInFlight(false)
      setIsOpeningWallet(false)
      await logBase("pending-wallet-action-error", {
        source,
        kind,
        paymentId,
        rejected,
        ...extractErrorDetails(dispatchErr),
      })
      if (rejected) {
        rejectWalletRequest()
        clearPendingWalletAction()
        activeBasePaymentAttemptRef.current = null
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
        const friendly = kind === "usdc_approve"
          ? "USDC authorization declined. Tap Try Again to restart."
          : "Payment declined. Tap Try Again to retry."
        setExecStageRef.current("retryable_error")
        setLocalError(friendly)
        onError?.(friendly)
        if (kind === "eth_payment") {
          await fetch(`/api/payments/${encodeURIComponent(paymentId)}/fail`, {
            method: "POST",
            headers: checkoutToken ? { Authorization: `Bearer ${checkoutToken}` } : {},
          }).catch(() => null)
          if (intentId) window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=cancelled`
        }
        return false
      }
      preservePendingWalletRequestUi(kind)
      setPendingWalletActionReady(true)
      setPendingWalletActionKind(kind)
      setBaseMobileStepRef.current("fallback_required")
      logBasePay("fallback_required", { actionKind: kind, reason: rejected ? "rejected" : "request-failed-or-blocked" })
      setExecStageRef.current(kind === "usdc_approve" ? "authorizing_usdc" : "confirm_payment", kind === "usdc_approve" ? { allowance: true } : undefined)
      setBasePayStatus(
        kind === "usdc_approve"
          ? "Wallet was interrupted. Retry USDC authorization."
          : "Wallet was interrupted. Retry payment approval."
      )
      setLocalError("")
      return false
    }
  }, [beginWalletRequest, clearPendingWalletAction, getProviderRequestDebugTimings, intentId, onError, onSuccess, preservePendingWalletRequestUi, recheckUsdcAllowanceAndQueueFinalPayment, rejectWalletRequest, resolveWalletRequest, selectedAsset, waitForWalletConnectSettlement, walletConnectConnector])
  dispatchPendingWalletActionRef.current = dispatchPendingWalletAction
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
    baseMobileStepRef.current = "idle"
    setBaseMobileStepRaw("idle")
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
          headers: {
            "Content-Type": "application/json",
            ...(checkoutToken ? { Authorization: `Bearer ${checkoutToken}` } : {}),
          },
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
      logBaseV6("payment_created", { paymentId })
      console.log("BASE PAYMENT URL:", paymentUrl)
      if (selectedAsset === "USDC") {
        console.info("[Base USDC] strategy response", {
          paymentId,
          baseUsdcStrategy,
          splitContract,
          paymentUrlKind: paymentUrl.startsWith("pinetree://base-v7")
            ? "pinetree://base-v7"
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
  // ─── Base V7 USDC execution ──────────────────────────────────────���─────────
  // Calls the server strategy endpoint, then executes the confirmed strategy.
  // No force flag — the server determines the best path.
  const executeBaseV6UsdcPayment = useCallback(async (input: {
    paymentData: PaymentData
    provider: WalletConnectProvider
    walletClient?: BaseWalletClient | null
    fromAddress: string
    peerName: string | null
    connector: Connector
    finalPaymentTxRef: { current: EvmTransactionRequest | null }
    finalPaymentIdRef: { current: string | null }
  }): Promise<string | null> => {
    if (activeBaseV6PaymentRef.current === input.paymentData.paymentId) {
      throw new Error("Base payment is already in progress. Please wait for the current attempt to finish.")
    }
    activeBaseV6PaymentRef.current = input.paymentData.paymentId
    const paymentId = input.paymentData.paymentId
    const capabilities = detectCapabilitiesFromProvider(input.peerName, input.provider)
    try {
      // ── 1. Get server-confirmed strategy ──────────────────────────────────────
      setBasePayStatus("Preparing payment...")
      console.info("[BASE V6] strategy-resolve-start", { paymentId, walletFamily: capabilities.walletFamily })
      logBaseV6("usdc_strategy_request_start", {
        paymentId,
        walletFamily: capabilities.walletFamily,
        supportsTypedData: capabilities.supportsTypedData,
        supportsSendCalls: capabilities.supportsSendCalls,
      })
      void logBase("v6-strategy-resolve-start", { paymentId, walletFamily: capabilities.walletFamily })
      const strategyRes = await fetch(
        `/api/payments/${encodeURIComponent(paymentId)}/base-v7/strategy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payerAddress: input.fromAddress,
            walletCapabilities: {
              walletFamily: capabilities.walletFamily,
              supportsSendCalls: capabilities.supportsSendCalls,
              supportsTypedData: capabilities.supportsTypedData,
              skipEip3009: capabilities.skipEip3009,
              skipDelegatedBatch: capabilities.skipDelegatedBatch
            }
          })
        }
      )
      const strategyData = (await strategyRes.json()) as BaseV6StrategyResponse
      if (!strategyRes.ok || !strategyData.ok) {
        throw new Error(strategyData.error || "Failed to resolve Base payment strategy")
      }
      const confirmedStrategy = strategyData.strategy
      console.info("[BASE V6] strategy-confirmed", {
        paymentId,
        strategy: confirmedStrategy,
        walletFamily: capabilities.walletFamily,
        debugSummary: strategyData.debugSummary
      })
      logBaseV6("usdc_strategy_response", {
        paymentId,
        strategy: confirmedStrategy,
        fallbackStrategy: strategyData.fallbackStrategy || null,
        relayerAvailable: Boolean(strategyData.relayerAvailable),
        allowanceSufficient: Boolean(strategyData.allowanceSufficient),
        requiredUsdcAmount: strategyData.requiredUsdcAmount || "",
        currentAllowance: strategyData.currentAllowance || "",
        walletFamily: strategyData.walletFamily || capabilities.walletFamily,
        supportsTypedData: strategyData.supportsTypedData ?? capabilities.supportsTypedData,
        supportsSendCalls: strategyData.supportsSendCalls ?? capabilities.supportsSendCalls,
      })
      void logBase("v6-strategy-confirmed", { paymentId, strategy: confirmedStrategy, walletFamily: capabilities.walletFamily })
      // ── 2. Execute confirmed strategy ─────────────────────────────────────────
      // ── Strategy: usdc_delegated_batch ────────────────────────────────────────
      if (confirmedStrategy === "usdc_delegated_batch") {
        logBaseV6("usdc_final_payment_tx_start", {
          paymentId,
          actionKind: "usdc_delegated",
          strategy: confirmedStrategy,
          method: "wallet_sendCalls",
          requestStarted: true,
        })
        const delegatedPrepareRes = await fetch(
          `/api/payments/${encodeURIComponent(paymentId)}/base-v7/delegated/prepare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payerAddress: input.fromAddress })
          }
        )
        const delegatedPrepared = (await delegatedPrepareRes.json()) as BaseDelegatedPrepareResponse
        if (
          delegatedPrepared.ok &&
          delegatedPrepared.enabled &&
          Array.isArray(delegatedPrepared.calls) &&
          delegatedPrepared.calls.length >= 2
        ) {
          console.info("[BASE V6] delegated-batch-start", { paymentId })
          setExecStageRef.current("confirm_payment")
          setBasePayStatus("Opening payment approval...")
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
                    data: call.data || "0x"
                  })),
                  capabilities: {}
                }
              ]
            })
            console.info("[BASE V6] delegated-batch-sent", { paymentId })
            logBaseV6("usdc_final_payment_tx_resolved", {
              paymentId,
              actionKind: "usdc_delegated",
              strategy: confirmedStrategy,
              method: "wallet_sendCalls",
              requestStarted: true,
            })
          } catch (sendCallsErr) {
            const sendMsg = extractErrorMessage(sendCallsErr)
            if (isRejectedError(sendCallsErr, sendMsg)) throw sendCallsErr
            activeWalletRequestRef.current = null
            console.info("[BASE V6] delegated-batch-unsupported-falling-through", { paymentId, error: sendMsg })
            // Fall through to EIP-3009 or allowance path below
            throw new Error("wallet_sendCalls unsupported. Please try again �� a different approval method will be used.")
          }
          resolveWalletRequest()
          let finalTxHash = extractDirectFinalTxHashFromSendCallsResult(sendCallsResult)
          const callId = extractCallIdFromSendCallsResult(sendCallsResult)
          if (!finalTxHash && !callId) {
            throw new Error("Payment submitted but confirmation details were not returned. Please try again.")
          }
          if (!finalTxHash && callId) {
            setExecStageRef.current("submitting_payment")
            setBasePayStatus("Waiting for confirmation...")
            const maxAttempts = 20
            const delayMs = 3_000
            for (let attempt = 1; attempt <= maxAttempts && !finalTxHash; attempt++) {
              try {
                const statusResult = await input.provider.request({
                  method: "wallet_getCallsStatus",
                  params: [callId]
                })
                finalTxHash = extractFinalTxHashFromCallsStatus(statusResult)
                if (finalTxHash) break
              } catch { /* continue polling on transient errors */ }
              if (attempt < maxAttempts && !finalTxHash) {
                await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
              }
            }
          }
          if (!finalTxHash) {
            throw new Error("Payment confirmation was not returned by wallet. Please try again.")
          }
          console.info("[BASE V6] delegated-batch-final-tx", { paymentId, txHashPrefix: finalTxHash.slice(0, 10) })
          setBasePayStatus("Processing payment...")
          return normalizeHexTransactionHash(finalTxHash)
        }
        // Server said delegated is available but prepare returned disabled — fall through
        throw new Error("Delegated payment preparation failed. Please try again.")
      }
      // ── Strategy: usdc_eip3009_relayer ────────────────────────────────────────
      if (confirmedStrategy === "usdc_eip3009_relayer") {
        try {
          logBaseV6("usdc_eip3009_prepare_start", { paymentId, strategy: confirmedStrategy })
        const prepareRes = await fetch(
          `/api/payments/${encodeURIComponent(paymentId)}/base-v7/prepare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payerAddress: input.fromAddress })
          }
        )
        const prepare = (await prepareRes.json()) as BaseV6UsdcPrepareResponse
        if (!prepareRes.ok) throw new Error(prepare.error || "Failed to prepare Base USDC authorization")
        if (prepare.unavailable) throw new Error(prepare.message || BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE)
        if (!prepare.typedData || !prepare.authorization) {
          throw new Error("Incomplete Base USDC authorization returned by server")
        }
        setExecStageRef.current("confirm_payment")
        setBasePayStatus("Authorize USDC payment in your wallet.")
        const typedData = requireBaseUsdcTypedData(prepare.typedData, input.fromAddress)
        const serializedTypedData = serializeTypedDataForWallet(typedData)
        let signTimeoutHandle: ReturnType<typeof setTimeout> | null = null
        let signature = ""
        beginWalletRequest({ kind: "usdc_signature", walletName: input.peerName })
        try {
          logBaseV6("usdc_sign_typed_data_start", {
            paymentId,
            actionKind: "usdc_signature",
            strategy: confirmedStrategy,
            method: "eth_signTypedData_v4",
            requestStarted: true,
            providerRequestStarted: true,
            source: "eip3009",
            documentVisibility: typeof document !== "undefined" ? document.visibilityState : undefined,
          })
          logBaseV6("provider_request_start", {
            paymentId,
            selectedAsset,
            actionKind: "usdc_signature",
            strategy: confirmedStrategy,
            method: "eth_signTypedData_v4",
            requestStarted: true,
            providerRequestStarted: true,
            source: "eip3009",
            documentVisibility: typeof document !== "undefined" ? document.visibilityState : undefined,
          })
          const rawSig = await Promise.race([
            input.provider.request({
              method: "eth_signTypedData_v4",
              params: [input.fromAddress, serializedTypedData]
            }),
            new Promise<never>((_, reject) => {
              signTimeoutHandle = setTimeout(
                () => reject(new Error(BASE_USDC_SIGN_TIMEOUT_MESSAGE)),
                BASE_USDC_TX_REQUEST_TIMEOUT_MS
              )
            })
          ])
          if (signTimeoutHandle) clearTimeout(signTimeoutHandle)
          resolveWalletRequest()
          logBaseV6("provider_request_resolved", {
            paymentId,
            selectedAsset,
            actionKind: "usdc_signature",
            method: "eth_signTypedData_v4",
            hasTxHash: false,
            strategy: confirmedStrategy,
          })
          signature = String(rawSig || "").trim()
          if (!isValidAuthorizationSignature(signature)) {
            throw new Error("Wallet did not return a valid USDC V6 authorization signature")
          }
          void logBase("v6-auth-success", { paymentId, signaturePrefix: signature.slice(0, 10) })
        } catch (signErr) {
          if (signTimeoutHandle) clearTimeout(signTimeoutHandle)
          const signMsg = extractErrorMessage(signErr)
          if (isRejectedError(signErr, signMsg) || signMsg === BASE_USDC_SIGN_TIMEOUT_MESSAGE) {
            throw signErr
          }
          activeWalletRequestRef.current = null
          if (input.walletClient?.signTypedData && shouldTryTypedDataWalletClientFallback(signErr, signMsg)) {
            try {
              signature = await input.walletClient.signTypedData({
                account: input.fromAddress,
                domain: typedData.domain,
                types: typedData.types,
                primaryType: typedData.primaryType,
                message: typedData.message
              })
              if (!isValidAuthorizationSignature(signature)) {
                throw new Error("Wallet did not return a valid USDC V6 authorization signature")
              }
              void logBase("v6-auth-success", { paymentId, method: "walletClient", signaturePrefix: signature.slice(0, 10) })
            } catch (signErrB) {
              const signMsgB = extractErrorMessage(signErrB)
              if (isRejectedError(signErrB, signMsgB)) throw signErrB
              throw new Error("USDC authorization signature failed. Please try again.")
            }
          } else {
            throw new Error("USDC authorization signature failed. Please try again.")
          }
        }
        setBasePayStatus("Processing payment...")
        console.info("[BASE V6] relay-start", { paymentId })
        logBaseV6("usdc_relay_start", {
          paymentId,
          actionKind: "usdc_signature",
          strategy: confirmedStrategy,
          requestStarted: true,
        })
        const relayRes = await fetch(
          `/api/payments/${encodeURIComponent(paymentId)}/base-v7/relay`,
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
        const relay = (await relayRes.json()) as BaseV6UsdcRelayResponse
        if (!relayRes.ok) throw new Error(relay.error || "Failed to relay Base USDC payment")
        if (relay.unavailable) throw new Error(relay.message || BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE)
        const relayTxHash = normalizeHexTransactionHash(relay.txHash)
        console.info("[BASE V6] relay-success", { paymentId, txHashPrefix: relayTxHash.slice(0, 10) })
        logBaseV6("usdc_relay_resolved", {
          paymentId,
          actionKind: "usdc_signature",
          strategy: confirmedStrategy,
          hasTxHash: true,
        })
        logBaseV6("tx_hash_captured", {
          paymentId,
          actionKind: "usdc_signature",
          strategy: confirmedStrategy,
          hasTxHash: true,
        })
        setBasePayStatus("Processing payment...")
        return relayTxHash
        } catch (eip3009Err) {
          const eip3009Msg = extractErrorMessage(eip3009Err)
          if (isActualUserRejectedError(eip3009Err, eip3009Msg) || eip3009Msg === BASE_USDC_SIGN_TIMEOUT_MESSAGE) {
            throw eip3009Err
          }
          activeWalletRequestRef.current = null
          logBaseV6("fallback_required", {
            paymentId,
            actionKind: "usdc_signature",
            strategy: confirmedStrategy,
            reason: eip3009Msg || "eip3009-failed",
            fallbackStrategy: "usdc_allowance_two_step",
          })
          setBasePayStatus("USDC signature failed. Falling back to wallet transaction approval...")
        }
      }
      // ── Strategy: usdc_allowance_direct / usdc_allowance_two_step ───���─────────
      logBaseV6("usdc_final_payment_build_start", {
        paymentId,
        selectedAsset,
        actionKind: "usdc_payment",
        strategy: confirmedStrategy,
        hasAccount: Boolean(input.fromAddress),
      })
      const buildRes = await fetch(
        `/api/payments/${encodeURIComponent(paymentId)}/base-v7/build-allowance-payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payerAddress: input.fromAddress })
        }
      )
      const buildData = (await buildRes.json()) as BaseV6UsdcAllowancePaymentResponse
      if (!buildRes.ok) throw new Error(buildData.error || "Failed to build Base USDC allowance payment")
      if (buildData.unavailable) throw new Error(buildData.message || BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE)
      if (!buildData.ok || !buildData.paymentTx) {
        throw new Error("Incomplete allowance payment data returned by server")
      }
      const { sufficient, approveTx, paymentTx } = buildData as Required<Pick<BaseV6UsdcAllowancePaymentResponse, "sufficient" | "approveTx" | "paymentTx">>
      const allowanceExecutionStrategy = sufficient ? "usdc_allowance_direct" : "usdc_allowance_two_step"
      logBaseV6("usdc_allowance_check", {
        paymentId,
        strategy: allowanceExecutionStrategy,
        allowanceSufficient: Boolean(sufficient),
        requiredUsdcAmount: buildData.requiredAmount || "",
        currentAllowance: buildData.currentAllowance || "",
      })
      input.finalPaymentTxRef.current = paymentTx
      input.finalPaymentIdRef.current = paymentId
      if (!sufficient && approveTx) {
        // Two-step: approve first
        console.info("[BASE V6] allowance-two-step-approve", { paymentId })
        setExecStageRef.current("authorizing_usdc", { allowance: true })
        setBasePayStatus("Approve USDC authorization in your wallet.")
        void logBase("v6-approve-requested", { paymentId })
        pendingUsdcApproveTxRef.current = approveTx
        queuePendingWalletAction({ kind: "usdc_approve", paymentId, ready: true })
        activeBasePaymentAttemptRef.current = null
        activeBaseV6PaymentRef.current = null
        setIsOpeningWallet(false)
        setBaseMobileStepRef.current("usdc_authorization_ready")
        return null
      }
      // Direct (sufficient allowance) or two-step second phase
      input.finalPaymentTxRef.current = paymentTx
      input.finalPaymentIdRef.current = paymentId
      console.info("[BASE V6] allowance-payment-ready", { paymentId, sufficient: Boolean(sufficient) })
      setExecStageRef.current("confirm_payment")
      setBasePayStatus("Opening payment approval")
      void logBase("v6-payment-requested", { paymentId })
      queuePendingWalletAction({ kind: "usdc_payment", paymentId, ready: true })
      activeBasePaymentAttemptRef.current = null
      activeBaseV6PaymentRef.current = null
      setIsOpeningWallet(false)
      setBaseMobileStepRef.current("payment_ready")
      return null
    } catch (error) {
      activeBaseV6PaymentRef.current = null
      logBaseV6("error", {
        paymentId,
        reason: extractErrorMessage(error) || "usdc-v6-execution-failed",
      })
      throw error
    }
  }, [beginWalletRequest, queuePendingWalletAction, resolveWalletRequest, selectedAsset])
  const continueBasePayment = useCallback(async (connectedAddress: string) => {
    if (isSendingBaseTxRef.current) return
    if (paymentSubmittedRef.current) return
    isSendingBaseTxRef.current = true
    let createdPaymentId = ""
    let createdBaseV6Payment = false
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
      setExecStageRef.current("wallet_connected")
      setIsResolvingAccountRef.current(true)
      const settledSession = await waitForWalletConnectSettlement("continue-base-payment")
      setIsResolvingAccountRef.current(false)
      if (!settledSession) {
        throw new Error("Wallet connection is still settling. Please return here after approving the wallet connection.")
      }
      if (settledSession.peerName) setConnectedPeerName(settledSession.peerName)
      let fromAddress = settledSession.address || String(connectedAddress || "").trim()
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
      const alreadyOnBase = isOnBase || settledSession.chainId === base.id || connectedChainIdRef.current === base.id
      connectedChainIdRef.current = null
      if (!alreadyOnBase) {
        try {
          logBasePay("switch_chain_start", { chainId: base.id })
          await switchChainAsync({ chainId: base.id })
          logBasePay("switch_chain_done", { chainId: base.id })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!message.toLowerCase().includes("already") && !message.includes(String(base.id))) {
            throw error
          }
          logBasePay("switch_chain_done", { chainId: base.id })
        }
      }
      // ── Final USDC payment resume path ────────────────────────────────────────
      // If a final payment tx was stored before a previous failed dispatch (e.g. stale
      // provider after approve mobile handoff), skip rebuild and dispatch directly.
      // This satisfies the requirement: no button press, no build-allowance-payment repeat.
      if (
        selectedAsset === "USDC" &&
        usdcFinalPaymentTxRef.current &&
        usdcFinalPaymentIdRef.current &&
        !pendingActionKindRef.current &&
        (execStageRef.current === "confirm_payment" || execStageRef.current === "usdc_authorized")
      ) {
        const storedPaymentTx = usdcFinalPaymentTxRef.current
        const storedPaymentId = usdcFinalPaymentIdRef.current
        createdPaymentId = storedPaymentId
        activeBasePaymentAttemptRef.current = `${storedPaymentId}:USDC`
        setExecStageRef.current("confirm_payment")
        setBasePayStatus("Opening payment approval")
        console.log("[BASE USDC CHAIN] payment-request-build-ready", { paymentId: storedPaymentId, via: "resume" })
        void logBase("[BASE USDC CHAIN] payment-request-build-ready", { paymentId: storedPaymentId, via: "resume" })
        const resumeProvider = settledSession.provider
        const resumePeerName = settledSession.peerName
        console.log("[BASE USDC CHAIN] payment-request-dispatch", { paymentId: storedPaymentId, via: "resume" })
        void logBase("[BASE USDC CHAIN] payment-request-dispatch", { paymentId: storedPaymentId, via: "resume" })
        beginWalletRequest({ kind: "usdc_payment", walletName: resumePeerName })
        void logBase("[BASE USDC CHAIN] payment-request-pending", { paymentId: storedPaymentId })
        let resumeTxHash: string
        try {
          resumeTxHash = await sendWalletConnectTransactionWithTimeout({
            provider: resumeProvider,
            fromAddress,
            txRequest: storedPaymentTx,
            paymentId: storedPaymentId,
            timeoutMs: BASE_USDC_TX_REQUEST_TIMEOUT_MS,
            timeoutMessage: "Payment transaction was not completed. Retry payment approval to try again.",
            actionKind: "usdc_payment",
            debugTimings: getProviderRequestDebugTimings("usdc_payment", "resume-final-payment"),
          })
        } catch (resumeErr) {
          void logBase("[BASE USDC CHAIN] payment-request-error", {
            paymentId: storedPaymentId,
            via: "resume",
            ...extractErrorDetails(resumeErr),
          })
          throw resumeErr
        }
        resolveWalletRequest()
        usdcFinalPaymentTxRef.current = null
        usdcFinalPaymentIdRef.current = null
        console.log("[BASE USDC CHAIN] payment-submitted", { paymentId: storedPaymentId, via: "resume", txHashPrefix: resumeTxHash.slice(0, 10) })
        void logBase("[BASE USDC CHAIN] payment-submitted", { paymentId: storedPaymentId, txHashPrefix: resumeTxHash.slice(0, 10) })
        console.log("[BASE USDC CHAIN] final-tx", { paymentId: storedPaymentId, via: "resume", txHashPrefix: resumeTxHash.slice(0, 10) })
        void logBase("[BASE USDC CHAIN] final-tx", { paymentId: storedPaymentId, txHashPrefix: resumeTxHash.slice(0, 10) })
        paymentSubmittedRef.current = true
        activeBasePaymentAttemptRef.current = null
        setExecStageRef.current("payment_submitted")
        void logBase("detect-start", { paymentId: storedPaymentId, txHashPrefix: resumeTxHash.slice(0, 10) })
        logBasePay("network_confirmation_entered", { hasTxHash: true, actionKind: "usdc_payment" })
        logBaseV6("network_confirmation_entered", { paymentId: storedPaymentId, selectedAsset, actionKind: "usdc_payment", hasTxHash: true })
        setExecStageRef.current("detecting")
        await onSuccess?.(resumeTxHash, storedPaymentId)
        void logBase("detect-success", { paymentId: storedPaymentId })
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
        if (intentId) {
          window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
        }
        return
      }
      // ── End final USDC payment resume path ────────────────────────────────────
      setIsOpeningWallet(true)
      setExecStageRef.current("preparing_payment")
      void logBase("resolve-payment-start", { intentId: intentId || null })
      const prefetched = selectedAsset === "ETH" || selectedAsset === "USDC"
        ? prefetchedPaymentDataRef.current
        : null
      if (prefetched) prefetchedPaymentDataRef.current = null
      const paymentData = prefetched ?? await resolvePaymentData()
      createdPaymentId = paymentData.paymentId
      logBaseV6("payment_loaded", { paymentId: paymentData.paymentId })
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
      const walletConnectProvider = settledSession.provider
      logBaseV6("wallet_session_ready", {
        paymentId: paymentData.paymentId,
        hasAccount: Boolean(fromAddress),
        chainId: settledSession.chainId || base.id,
      })
      // Route USDC payments to the correct execution path based on strategy/URL.
      // V7: v7_eip3009_relayer strategy or pinetree://base-v7 URL (active path).
      // All USDC payments go through V7 execution regardless of pre-assigned strategy.
      // executeBaseV6UsdcPayment calls the server strategy endpoint fresh and handles
      // every branch: delegated_batch, eip3009_relayer, allowance_direct, allowance_two_step.
      const isBaseV6 = selectedAsset === "USDC"
      createdBaseV6Payment = isBaseV6
      console.log("[PineTreeBaseTrace] BaseWalletPayment branch selected", {
        step: "branch-selection",
        selectedAsset,
        paymentId: paymentData.paymentId,
        baseUsdcStrategy: paymentData.baseUsdcStrategy || null
      })
      console.log("[BASE USDC CHAIN] start", {
        paymentId: paymentData.paymentId,
        baseUsdcStrategy: paymentData.baseUsdcStrategy || null,
      })
      if (isBaseV6) {
        console.info("[BASE V6] v6-strategy-detected", {
          paymentId: paymentData.paymentId,
          splitContract: paymentData.splitContract,
          paymentUrlKind: paymentData.paymentUrl.startsWith("pinetree://base-v7")
            ? "pinetree://base-v7"
            : "other"
        })
        const peerName = getWalletConnectPeerName(walletConnectProvider)
        const normalizedTxHash = await executeBaseV6UsdcPayment({
          paymentData,
          provider: walletConnectProvider,
          walletClient: (walletClient as BaseWalletClient | undefined) || null,
          fromAddress,
          peerName,
          connector: walletConnectConnector,
          finalPaymentTxRef: usdcFinalPaymentTxRef,
          finalPaymentIdRef: usdcFinalPaymentIdRef,
        })
        if (!normalizedTxHash) {
          setIsOpeningWallet(false)
          return
        }
        paymentSubmittedRef.current = true
        activeBasePaymentAttemptRef.current = null
        activeBaseV6PaymentRef.current = null
        setExecStageRef.current("payment_submitted")
        console.log("[BASE UI] final-tx-submitted", { paymentId: paymentData.paymentId, txHashPrefix: normalizedTxHash.slice(0, 10), asset: "USDC", version: "v6" })
        void logBase("detect-start", { paymentId: paymentData.paymentId, txHashPrefix: normalizedTxHash.slice(0, 10) })
        logBasePay("network_confirmation_entered", { hasTxHash: true, actionKind: "usdc_payment" })
        logBaseV6("network_confirmation_entered", { paymentId: paymentData.paymentId, selectedAsset, actionKind: "usdc_payment", hasTxHash: true })
        setExecStageRef.current("detecting")
        await onSuccess?.(normalizedTxHash, paymentData.paymentId)
        void logBase("detect-success", { paymentId: paymentData.paymentId })
        clearPendingBaseWalletConnectPayment()
        setHasPendingBaseWcPayment(false)
        if (intentId) {
          window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
        }
        return
      }
      const txRequest = cachedTxRequest ?? parseEthereumPaymentUri(paymentData.paymentUrl)
      logBaseV6("eth_prepare_start", {
        paymentId: paymentData.paymentId,
        actionKind: "eth_payment",
        chainId: txRequest.chainId,
      })
      void logBase("eth-payment-requested", {
        paymentId: paymentData.paymentId,
        to: txRequest.to,
        hasData: Boolean(txRequest.data),
        hasValue: Boolean(txRequest.value),
      })
      transactionPromptStarted = true
      // Store for mobile handoff recovery (catch block queues it if provider.request throws).
      pendingEthPaymentTxRef.current = txRequest
      // Track auto-dispatch attempt so the pending-action system doesn't re-fire
      // if the user manually retries after a handoff failure.
      const ethAttemptKey = `${paymentData.paymentId}:${selectedAsset}:eth_payment`
      setExecStageRef.current("confirm_payment")
      setBaseMobileStepRef.current("payment_dispatching")
      setBasePayStatus("Approve payment in your wallet...")
      // Use the already-settled session provider directly — no second settlement wait.
      // This keeps the gap between connection approval and payment approval as small
      // as possible on mobile, eliminating the "bounce back to browser" inconsistency.
      closeWalletConnectSelectionModal(walletConnectProvider)
      beginWalletRequest({ kind: "eth_payment", walletName: settledSession.peerName })
      setBaseMobileStepRef.current("payment_in_wallet")
      console.log("[BASE UI] eth-payment-direct-dispatch", { paymentId: paymentData.paymentId })
      const ethTxHash = await sendWalletConnectTransactionWithTimeout({
        provider: walletConnectProvider,
        fromAddress,
        txRequest,
        paymentId: paymentData.paymentId,
        timeoutMs: BASE_ETH_TX_REQUEST_TIMEOUT_MS,
        timeoutMessage: BASE_ETH_TX_TIMEOUT_MESSAGE,
        actionKind: "eth_payment",
        onProviderRequestStarted: () => {
          autoWalletActionAttemptedKeyRef.current.add(ethAttemptKey)
        },
        debugTimings: getProviderRequestDebugTimings("eth_payment", "continue-direct"),
      })
      resolveWalletRequest()
      closeWalletConnectSelectionModal(walletConnectProvider)
      pendingEthPaymentTxRef.current = null
      clearPendingWalletAction()
      paymentSubmittedRef.current = true
      activeBasePaymentAttemptRef.current = null
      setExecStageRef.current("payment_submitted")
      setBaseMobileStepRef.current("payment_submitted")
      setIsOpeningWallet(false)
      console.log("[BASE UI] final-tx-submitted", { paymentId: paymentData.paymentId, txHashPrefix: ethTxHash.slice(0, 10), asset: "ETH" })
      void logBase("eth-payment-submitted", { paymentId: paymentData.paymentId, txHashPrefix: ethTxHash.slice(0, 10) })
      void logBase("detect-start", { paymentId: paymentData.paymentId, txHashPrefix: ethTxHash.slice(0, 10) })
      logBasePay("network_confirmation_entered", { hasTxHash: true, actionKind: "eth_payment" })
      logBaseV6("network_confirmation_entered", { paymentId: paymentData.paymentId, selectedAsset, actionKind: "eth_payment", hasTxHash: true })
      logBasePay("waiting_for_payment_entered", { hasTxHash: true, actionKind: "eth_payment", step: "network_confirmation" })
      setExecStageRef.current("detecting")
      setBaseMobileStepRef.current("network_confirmation")
      await onSuccess?.(ethTxHash, paymentData.paymentId)
      void logBase("detect-success", { paymentId: paymentData.paymentId })
      clearPendingBaseWalletConnectPayment()
      setHasPendingBaseWcPayment(false)
      if (intentId) {
        window.location.href = `/pay?intent=${encodeURIComponent(intentId)}&status=processing`
      }
      return
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
          ? "Waiting for wallet response, or tap Try Again to restart."
          : message
      const failReason = getFailReason({
        selectedAsset,
        rejected,
        timedOut,
        transactionPromptStarted,
      })
      const isRetryableUsdcSigningFailure =
        createdBaseV6Payment &&
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
        isBaseV6: createdBaseV6Payment
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
          headers: checkoutToken ? { Authorization: `Bearer ${checkoutToken}` } : {},
        }).catch(() => null)
        // Keep checkout open — customer can still try another rail (Solana, Lightning).
      }
      if (isRetryableUsdcSigningFailure) {
        if (!isHandoff) {
          clearPendingBaseWalletConnectPayment()
          setHasPendingBaseWcPayment(false)
          activeBasePaymentAttemptRef.current = null
          activeBaseV6PaymentRef.current = null
        }
      }
      if (isHandoff) {
        const canQueueWalletAction =
          walletKind === "eth_payment" ||
          (walletKind === "usdc_approve" && Boolean(pendingUsdcApproveTxRef.current)) ||
          (walletKind === "usdc_payment" && Boolean(usdcFinalPaymentTxRef.current))
        if (canQueueWalletAction && createdPaymentId) {
          queuePendingWalletAction({ kind: walletKind, paymentId: createdPaymentId, ready: true })
        } else {
          preservePendingWalletRequestUi(walletKind)
        }
        setExecStageRef.current(walletKind === "usdc_approve" ? "authorizing_usdc" : "confirm_payment", walletKind === "usdc_approve" ? { allowance: true } : undefined)
        console.log("[BASE UI] wallet-handoff-pending", { message: friendly, walletKind, selectedAsset, intentId: intentId || null })
        setLocalError("")
        setIsPreparingPayment(false)
        setIsOpeningWallet(false)
        if (walletKind === "usdc_approve") {
          setBasePayStatus("Approve USDC authorization in your wallet.")
        } else {
          setBasePayStatus("Opening payment approval")
        }
        // For USDC handoffs, clear attempt locks so resume handlers either
        // re-dispatch the stored transaction action or rebuild/re-dispatch the
        // typed-data authorization request. Otherwise the checkout can keep
        // saying "open wallet" with no pending WalletConnect request.
        if (walletKind === "usdc_payment" || walletKind === "usdc_approve" || walletKind === "usdc_signature") {
          activeBasePaymentAttemptRef.current = null
          activeBaseV6PaymentRef.current = null
          autoResumeAttemptedKeyRef.current = null
          sessionSettleTriggerFiredRef.current = false
          window.setTimeout(() => {
            triggerBaseAutoResumeRef.current?.("usdc-handoff")
          }, 100)
        }
        return
      }
      setExecStageRef.current("retryable_error")
      console.log("[BASE UI] retryable-error", { message: friendly, isHandoff, walletKind, selectedAsset, intentId: intentId || null })
      setLocalError(friendly)
      setIsPreparingPayment(false)
      setIsOpeningWallet(false)
      setBasePayStatus("")
      onError?.(friendly)
    } finally {
      isSendingBaseTxRef.current = false
    }
  }, [beginWalletRequest, chain?.id, clearPendingWalletAction, connector?.id, connector?.name, enforceActivePaymentBeforeWalletConnect, executeBaseV6UsdcPayment, getProviderRequestDebugTimings, intentId, isOnBase, onError, onSuccess, resolvePaymentData, resolveWalletRequest, selectedAsset, switchChainAsync, waitForWalletConnectSettlement, walletClient, walletConnectConnector])
  const resetBasePaymentAttemptForRetry = useCallback(() => {
    const hadStaleState = Boolean(
      activeBasePaymentAttemptRef.current ||
      activeBaseV6PaymentRef.current ||
      activeWalletRequestRef.current ||
      pendingActionKindRef.current ||
      pendingActionPaymentIdRef.current ||
      pendingActionInFlightRef.current
    )
    activeBasePaymentAttemptRef.current = null
    activeBaseV6PaymentRef.current = null
    activeWalletRequestRef.current = null
    clearPendingWalletAction()
    setWalletRequestUiState("idle")
    setPendingWalletRequestKind(null)
    isSendingBaseTxRef.current = false
    paymentSubmittedRef.current = false
    sessionSettleTriggerFiredRef.current = false
    walletConnectionApprovedAtRef.current = null
    browserReturnedAtRef.current = null
    browserBackgroundedAtRef.current = null
    usdcApprovalTxHashAtRef.current = null
    prefetchedPaymentDataRef.current = null
    prefetchedTxRequestRef.current = null
    autoResumeAttemptedKeyRef.current = null
    autoWalletActionAttemptedKeyRef.current.clear()
    autoWalletActionDispatchingKeyRef.current.clear()
    setBasePayStatus("")
    setIsResolvingAccount(false)
    clearPendingBaseWalletConnectPayment()
    setHasPendingBaseWcPayment(false)
    execStageRef.current = "idle"
    setExecStageRaw("idle")
    baseMobileStepRef.current = "idle"
    setBaseMobileStepRaw("idle")
    setUsedEmergencyAllowance(false)
    setWalletHandoffPending(false)
    usdcFinalPaymentTxRef.current = null
    usdcFinalPaymentIdRef.current = null
    if (hadStaleState) {
      logBaseV6("stale_state_reset", { reason: "new-payment-start" })
    }
  }, [clearPendingWalletAction])
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
          // Already connected — skip the connect step.
          // Mark the session-settle trigger consumed immediately so the useEffect
          // below does not race and fire a second continueBasePayment call for
          // the same payment before isSendingBaseTxRef is set.
          sessionSettleTriggerFiredRef.current = true
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
        logBasePay("connect_start", { selectedAsset, intentId: intentId || null })
        beginWalletRequest({ kind: "connect", walletName: null })
        if (selectedAsset === "ETH" || selectedAsset === "USDC") {
          // Connect first; payment requests wait for a settled WalletConnect account.
          const connectPromise = connectAsync({ connector: walletConnectConnector, chainId: base.id })
          let connectResult: Awaited<ReturnType<typeof connectAsync>>
          try {
            connectResult = await connectPromise
            logBasePay("connect_resolved", { selectedAsset, hasAccount: Boolean(extractAddressFromConnectResult(connectResult)) })
            markWalletConnectionApproved("connectAsync-resolved", {
              hasAccount: Boolean(extractAddressFromConnectResult(connectResult)),
              chainId: connectResult.chainId,
            })
            try {
              closeWalletConnectSelectionModal(await getWalletConnectProvider(walletConnectConnector))
            } catch {
              closeWalletConnectSelectionModal()
            }
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
            const settledSession = await waitForWalletConnectSettlement("connect-error-settle")
            if (settledSession) {
              setExecStageRef.current("wallet_connected")
              setConnectedPeerName(settledSession.peerName)
              console.log("[BASE UI] wallet-connected", { intentId: intentId || null, selectedAsset, source: "connect-error-settle" })
              void logBase("wc-connect-success-after-error", {
                hasAddress: true,
                chainId: settledSession.chainId,
                selectedAsset,
              })
              await continueBasePayment(settledSession.address)
              return
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
            markWalletConnectionApproved("connectAsync-address", {
              hasAccount: Boolean(fromAddress),
              chainId: connectedChainIdRef.current,
            })
            void logBase("wc-connect-success", {
              hasAddress: Boolean(fromAddress),
              chainId: connectedChainIdRef.current,
              selectedAsset,
            })
          }
          await continueBasePayment(fromAddress)
        } else {
          let fromAddress = ""
          try {
            const result = await connectAsync({ connector: walletConnectConnector, chainId: base.id })
            logBasePay("connect_resolved", { selectedAsset, hasAccount: Boolean(extractAddressFromConnectResult(result)) })
            markWalletConnectionApproved("connectAsync-resolved", {
              hasAccount: Boolean(extractAddressFromConnectResult(result)),
            })
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
        setBasePayStatus("")
        onError?.(friendly)
      }
    })()
  }, [address, connectAsync, continueBasePayment, enforceActivePaymentBeforeWalletConnect, intentId, isConnected, markWalletConnectionApproved, onError, onExecutionStarted, resetBasePaymentAttemptForRetry, resolvePaymentData, selectedAsset, waitForWalletConnectSettlement, walletConnectConnector])
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
    if (pendingActionKindRef.current && !pendingActionInFlightRef.current) {
      setPendingWalletActionReady(true)
      setWalletHandoffPending(true)
      await logBase("auto-resume-provider-check-skipped", {
        source,
        reason: "pending-wallet-action-ready",
        walletRequestKind: pendingActionKindRef.current,
      })
      return false
    }
    if (activeWalletRequestRef.current?.pending && activeWalletRequestRef.current.kind !== "connect") {
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
    try {
      const provider = await getWalletConnectProvider(walletConnectConnector)
      logBasePay("provider_ready", { ready: true, source })
      const accounts = await provider.request({ method: "eth_accounts", params: [] })
      const providerAddress = extractAddressFromConnectResult(accounts) || String(address || "").trim()
      logBasePay("accounts_detected", { hasAccount: Boolean(providerAddress) })
      let providerChainId: number | null = null
      try {
        const chainIdResult = await provider.request({ method: "eth_chainId", params: [] })
        providerChainId = Number(BigInt(String(chainIdResult || "0x0")))
      } catch {
        providerChainId = null
      }
      logBasePay("chain_detected", { chainId: providerChainId || chain?.id || connectedChainIdRef.current || null })
      await logBase("auto-resume-provider-check", {
        source,
        hasProviderAddress: Boolean(providerAddress),
        hasProvider: Boolean(provider),
        wagmiConnected: isConnected,
        activeConnectorId: connector?.id || null,
        chainId: providerChainId || chain?.id || connectedChainIdRef.current || null,
      })
      if (!providerAddress) return false
      if (providerChainId) connectedChainIdRef.current = providerChainId
      addressRef.current = providerAddress
      if (!markAutomaticResumeAttempt(source, providerAddress)) return false
      stopAutoResumeRetry()
      void continueBasePayment(providerAddress)
      return true
    } catch (error) {
      logBasePay("provider_ready", { ready: false, source })
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
    void logBase("auto-resume-scheduled", { delayMs: 0 })
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
      if (!markAutomaticResumeAttempt(source, capturedAddress)) return
      void logBase("auto-resume-fired", { hasAddress: Boolean(capturedAddress) })
      void continueBasePayment(capturedAddress)
    }, 0)
  }, [address, connector, continueBasePayment, intentId, isConnected, isOpeningWallet, markAutomaticResumeAttempt, selectedAsset, stopAutoResumeRetry])
  const startBaseWalletConnectAutoResumeRetry = useCallback((source: string) => {
    if (source === "focus" || source === "visibilitychange" || source === "pageshow") {
      browserReturnedAtRef.current = Date.now()
      logBasePay("browser_return_reconcile", {
        eventType: source,
        actionKind: pendingActionKindRef.current || activeWalletRequestRef.current?.kind || null,
      })
      logBaseV6("browser_returned", {
        selectedAsset,
        source,
        actionKind: pendingActionKindRef.current || activeWalletRequestRef.current?.kind || null,
        documentVisibility: typeof document !== "undefined" ? document.visibilityState : undefined,
      })
    }
    if (terminalStatus) return
    if (selectedAsset !== "ETH" && selectedAsset !== "USDC") return
    if (!pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset)) return
    if (isSendingBaseTxRef.current || paymentSubmittedRef.current) return
    if (pendingActionKindRef.current && !pendingActionInFlightRef.current) {
      const currentAddress = String(address || addressRef.current || "").trim()
      if (/^0x[a-fA-F0-9]{40}$/.test(currentAddress)) {
        addressRef.current = currentAddress
        const pendingPaymentId = pendingActionPaymentIdRef.current
        if (selectedAsset === "USDC" && pendingActionKindRef.current === "usdc_approve" && pendingPaymentId) {
          void recheckUsdcAllowanceAndQueueFinalPayment({
            paymentId: pendingPaymentId,
            fromAddress: currentAddress,
            source,
            maxWaitMs: 8_000,
          }).then((queuedFinal) => {
            if (!queuedFinal) {
              if (pendingActionKindRef.current === "usdc_approve" && pendingActionPaymentIdRef.current === pendingPaymentId) {
                setPendingWalletActionReady(true)
                setWalletHandoffPending(true)
              }
              return
            }
            window.setTimeout(() => {
              void dispatchPendingWalletActionRef.current?.("auto-usdc-final-after-return")
            }, 0)
          }).catch((error) => {
            logBaseV6("fallback_required", {
              paymentId: pendingPaymentId,
              selectedAsset,
              actionKind: "usdc_approve",
              fallbackReason: extractErrorMessage(error) || "allowance-recheck-failed",
            })
            if (pendingActionKindRef.current === "usdc_approve" && pendingActionPaymentIdRef.current === pendingPaymentId) {
              setPendingWalletActionReady(true)
              setWalletHandoffPending(true)
            }
          })
          void logBase("pending-wallet-action-reconcile", { source, kind: "usdc_approve", paymentId: pendingPaymentId })
          return
        }
        setPendingWalletActionReady(true)
        setWalletHandoffPending(true)
        void logBase("pending-wallet-action-ready", { source, kind: pendingActionKindRef.current })
        return
      }
      if (!autoResumeRetryRef.current) {
        autoResumeRetryStartedAtRef.current = Date.now()
        autoResumeRetryRef.current = setInterval(() => {
          if (Date.now() - autoResumeRetryStartedAtRef.current > BASE_WC_AUTO_RESUME_RETRY_TIMEOUT_MS) {
            void logBase("auto-resume-retry-timeout", { source, pendingAction: pendingActionKindRef.current })
            stopAutoResumeRetry()
            return
          }
          setPendingWalletActionReady(true)
          setWalletHandoffPending(true)
        }, BASE_WC_AUTO_RESUME_RETRY_MS)
      }
      setPendingWalletActionReady(true)
      setWalletHandoffPending(true)
      return
    }
    if (activeBasePaymentAttemptRef.current !== null) return
    if (activeWalletRequestRef.current?.pending && activeWalletRequestRef.current.kind !== "connect") {
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
      void logBase("auto-resume-waiting-for-connected-walletconnect", {
        source,
        isConnected,
        hasAddress: Boolean(address),
        activeConnectorId: connector?.id || null,
      })
      refreshPendingState()
      void resumeFromWalletConnectProvider(source)
      if (!autoResumeRetryRef.current) {
        autoResumeRetryStartedAtRef.current = Date.now()
        autoResumeRetryRef.current = setInterval(() => {
          if (Date.now() - autoResumeRetryStartedAtRef.current > BASE_WC_AUTO_RESUME_RETRY_TIMEOUT_MS) {
            void logBase("auto-resume-retry-timeout", { source })
            stopAutoResumeRetry()
            return
          }
          if (pendingActionKindRef.current && !pendingActionInFlightRef.current) {
            setPendingWalletActionReady(true)
            setWalletHandoffPending(true)
            return
          }
          void resumeFromWalletConnectProvider(`${source}-retry`)
        }, BASE_WC_AUTO_RESUME_RETRY_MS)
      }
      return
    }
    if (autoResumeRetryRef.current) stopAutoResumeRetry()
    tryResumeBaseWalletConnectPayment(source)
  }, [address, connector, intentId, isConnected, isConnecting, recheckUsdcAllowanceAndQueueFinalPayment, refreshPendingState, resumeFromWalletConnectProvider, selectedAsset, stopAutoResumeRetry, terminalStatus, tryResumeBaseWalletConnectPayment])
  triggerBaseAutoResumeRef.current = startBaseWalletConnectAutoResumeRetry
  useEffect(() => {
    refreshPendingState()
  }, [refreshPendingState])
  useEffect(() => {
    const hadStaleState = Boolean(
      activeBasePaymentAttemptRef.current ||
      activeBaseV6PaymentRef.current ||
      activeWalletRequestRef.current ||
      pendingActionKindRef.current ||
      pendingActionPaymentIdRef.current ||
      pendingActionInFlightRef.current
    )
    paymentSubmittedRef.current = false
    isSendingBaseTxRef.current = false
    prefetchedPaymentDataRef.current = null
    prefetchedProviderRef.current = null
    prefetchedTxRequestRef.current = null
    clearPendingWalletAction()
    autoResumeAttemptedKeyRef.current = null
    autoWalletActionAttemptedKeyRef.current.clear()
    autoWalletActionDispatchingKeyRef.current.clear()
    setBasePayStatus("")
    activeBasePaymentAttemptRef.current = null
    activeBaseV6PaymentRef.current = null
    activeWalletRequestRef.current = null
    connectedChainIdRef.current = null
    sessionSettleTriggerFiredRef.current = false
    usdcFinalPaymentTxRef.current = null
    usdcFinalPaymentIdRef.current = null
    walletConnectionApprovedAtRef.current = null
    browserReturnedAtRef.current = null
    browserBackgroundedAtRef.current = null
    usdcApprovalTxHashAtRef.current = null
    baseMobileStepRef.current = "idle"
    setBaseMobileStepRaw("idle")
    setWalletRequestUiState("idle")
    setPendingWalletRequestKind(null)
    setWalletHandoffPending(false)
    stopAutoResumeRetry()
    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current)
      autoResumeTimerRef.current = null
    }
    if (hadStaleState) {
      logBaseV6("stale_state_reset", { reason: "payment-context-change" })
    }
  }, [clearPendingWalletAction, pendingPaymentKey, stopAutoResumeRetry])
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
  }, [selectedAsset, startBaseWalletConnectAutoResumeRetry])
  useEffect(() => {
    if (!pendingWalletActionReady || pendingWalletActionInFlight) return
    const kind = pendingActionKindRef.current
    const paymentId = pendingActionPaymentIdRef.current
    if (!kind || !paymentId) return
    if (paymentSubmittedRef.current) return
    const attemptKey = `${paymentId}:${selectedAsset}:${kind}`
    if (autoWalletActionAttemptedKeyRef.current.has(attemptKey)) {
      setBaseMobileStepRef.current("fallback_required")
      logBasePay("fallback_required", { actionKind: kind, reason: "auto-dispatch-already-attempted" })
      logBaseV6("fallback_required", { paymentId, actionKind: kind, reason: "auto-dispatch-already-attempted" })
      return
    }
    if (autoWalletActionDispatchingKeyRef.current.has(attemptKey)) {
      return
    }
    autoWalletActionDispatchingKeyRef.current.add(attemptKey)
    setWalletHandoffPending(false)
    setBaseMobileStepRef.current(kind === "usdc_approve" ? "usdc_authorization_dispatching" : "payment_dispatching")
    void logBase("pending-wallet-action-auto-dispatch", {
      kind,
      paymentId,
      selectedAsset,
      step: kind === "usdc_approve" ? "usdc_authorization_dispatching" : "payment_dispatching",
    })
    void dispatchPendingWalletActionRef.current?.(`auto-${kind}`).then((ok) => {
      autoWalletActionDispatchingKeyRef.current.delete(attemptKey)
      if (ok) return
      if (paymentSubmittedRef.current) return
      if (pendingActionKindRef.current !== kind || pendingActionPaymentIdRef.current !== paymentId) return
      setBaseMobileStepRef.current("fallback_required")
      logBasePay("fallback_required", { actionKind: kind, reason: "auto-dispatch-failed" })
      logBaseV6("fallback_required", { paymentId, actionKind: kind, reason: "auto-dispatch-failed" })
    })
  }, [pendingWalletActionInFlight, pendingWalletActionReady, selectedAsset])
  useEffect(() => {
    const handleFocus = () => startBaseWalletConnectAutoResumeRetry("focus")
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        browserBackgroundedAtRef.current = Date.now()
        logBaseV6("browser_backgrounded", {
          selectedAsset,
          actionKind: pendingActionKindRef.current || activeWalletRequestRef.current?.kind || null,
          documentVisibility: document.visibilityState,
        })
        return
      }
      startBaseWalletConnectAutoResumeRetry("visibilitychange")
    }
    const handlePageShow = () => startBaseWalletConnectAutoResumeRetry("pageshow")
    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("pageshow", handlePageShow)
    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("pageshow", handlePageShow)
    }
  }, [selectedAsset, startBaseWalletConnectAutoResumeRetry])
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
    if (activeWalletRequestRef.current?.pending && activeWalletRequestRef.current.kind !== "connect") return
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
    const makeProviderEventHandler = (eventName: string) => (...args: unknown[]) => {
      logBasePay("session_event_received", { eventName })
      const eventAddress = extractAddressFromWalletConnectEvent(args)
      void logBase("auto-resume-provider-event", {
        hasEventAddress: Boolean(eventAddress),
        argCount: args.length,
      })
      if (eventAddress) {
        if (
          pendingPaymentMatches(getPendingBaseWalletConnectPayment(), intentId, selectedAsset) &&
          !pendingActionKindRef.current &&
          !isSendingBaseTxRef.current &&
          !paymentSubmittedRef.current &&
          activeBasePaymentAttemptRef.current === null
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
      void resumeFromWalletConnectProvider("provider-event")
    }
    const providerHandlers = {
      connect: makeProviderEventHandler("connect"),
      accountsChanged: makeProviderEventHandler("accountsChanged"),
      chainChanged: makeProviderEventHandler("chainChanged"),
      session_update: makeProviderEventHandler("session_update"),
      session_event: makeProviderEventHandler("session_event"),
    }
    void getWalletConnectProvider(walletConnectConnector)
      .then((resolvedProvider) => {
        if (cancelled) return
        provider = resolvedProvider
        provider.on?.("connect", providerHandlers.connect)
        provider.on?.("accountsChanged", providerHandlers.accountsChanged)
        provider.on?.("chainChanged", providerHandlers.chainChanged)
        provider.on?.("session_update", providerHandlers.session_update)
        provider.on?.("session_event", providerHandlers.session_event)
      })
      .catch(() => null)
    return () => {
      cancelled = true
      provider?.removeListener?.("connect", providerHandlers.connect)
      provider?.removeListener?.("accountsChanged", providerHandlers.accountsChanged)
      provider?.removeListener?.("chainChanged", providerHandlers.chainChanged)
      provider?.removeListener?.("session_update", providerHandlers.session_update)
      provider?.removeListener?.("session_event", providerHandlers.session_event)
    }
  }, [continueBasePayment, intentId, markAutomaticResumeAttempt, resumeFromWalletConnectProvider, selectedAsset, stopAutoResumeRetry, walletConnectConnector])
  // ── Render helpers ────────────────────────────────────────────────────────
  if (terminalStatus) {
    return (
      <div className="space-y-3">
        <div className="text-center text-xs font-semibold uppercase tracking-widest text-[#0052FF]">
          Base Network Payment
        </div>
        <PaymentStatusVisual status={terminalStatus} variant="card" />
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
  const showUsdcAuthStep = selectedAsset === "USDC" && (
    usedEmergencyAllowance ||
    baseMobileStep === "usdc_authorization_ready" ||
    baseMobileStep === "usdc_authorization_dispatching" ||
    baseMobileStep === "usdc_authorization_in_wallet" ||
    baseMobileStep === "usdc_authorization_submitted" ||
    pendingWalletActionKind === "usdc_approve"
  )
  const walletConnectedStatus: "done" | "active" | "upcoming" =
    baseMobileStep === "wallet_connecting"
      ? "active"
      : baseMobileStep === "idle"
        ? "upcoming"
        : "done"
  const usdcAuthStatus: "done" | "active" | "upcoming" = showUsdcAuthStep
    ? baseMobileStep === "usdc_authorization_ready" ||
      baseMobileStep === "usdc_authorization_dispatching" ||
      baseMobileStep === "usdc_authorization_in_wallet" ||
      (baseMobileStep === "fallback_required" && pendingWalletActionKind === "usdc_approve")
      ? "active"
      : baseMobileStep === "wallet_connecting" || baseMobileStep === "wallet_connected"
        ? "upcoming"
        : "done"
    : "done"
  const confirmPayStatus: "done" | "active" | "upcoming" =
    baseMobileStep === "payment_ready" ||
    baseMobileStep === "payment_dispatching" ||
    baseMobileStep === "payment_in_wallet" ||
    (baseMobileStep === "fallback_required" && pendingWalletActionKind !== "usdc_approve")
      ? "active"
      : baseMobileStep === "payment_submitted" || baseMobileStep === "network_confirmation" || baseMobileStep === "confirmed"
        ? "done"
        : showUsdcAuthStep
          ? "upcoming"
          : baseMobileStep === "wallet_connected"
            ? "active"
            : "upcoming"
  const networkConfStatus: "done" | "active" | "upcoming" =
    baseMobileStep === "confirmed"
      ? "done"
      : baseMobileStep === "network_confirmation"
        ? "active"
        : "upcoming"
  let contextMessage = ""
  if (execStage === "connecting_wallet" || execStage === "asset_selected") {
    contextMessage = "Opening wallet…"
  } else if (execStage === "wallet_connected" || execStage === "preparing_payment") {
    contextMessage = isResolvingAccount ? "Finalizing wallet connection…" : "Preparing payment…"
  } else if (execStage === "authorizing_usdc") {
    contextMessage = "Approve USDC authorization in your wallet."
  } else if (execStage === "usdc_authorized") {
    contextMessage = "Sending final payment approval."
  } else if (execStage === "confirm_payment") {
    contextMessage = activeWalletRequestRef.current?.kind === "usdc_signature"
      ? "Authorize USDC payment in your wallet."
      : "Approve in your wallet."
  } else if (execStage === "submitting_payment") {
    contextMessage = "Submitting payment..."
  } else if (execStage === "payment_submitted" || execStage === "detecting") {
    contextMessage = "Waiting for network confirmation…"
  }
  if (baseMobileStep === "wallet_connecting") {
    contextMessage = "Approve wallet connection in your wallet"
  } else if (baseMobileStep === "wallet_connected" || execStage === "preparing_payment") {
    contextMessage = isResolvingAccount ? "Finalizing wallet connection..." : "Preparing payment..."
  } else if (baseMobileStep === "usdc_authorization_ready") {
    contextMessage = "Approve USDC authorization in your wallet."
  } else if (baseMobileStep === "usdc_authorization_dispatching") {
    contextMessage = "Approve USDC authorization in your wallet."
  } else if (baseMobileStep === "usdc_authorization_in_wallet") {
    contextMessage = connectedPeerName
      ? `Authorization request sent to ${connectedPeerName}`
      : "Authorization request sent — check your wallet"
  } else if (baseMobileStep === "usdc_authorization_submitted") {
    contextMessage = "Sending final payment approval."
  } else if (baseMobileStep === "payment_ready") {
    contextMessage = "Preparing payment confirmation..."
  } else if (baseMobileStep === "payment_dispatching") {
    contextMessage = selectedAsset === "USDC" ? "Approve final payment in your wallet." : "Sending payment request to your wallet..."
  } else if (baseMobileStep === "payment_in_wallet") {
    contextMessage = connectedPeerName
      ? selectedAsset === "USDC" ? `Final payment request sent to ${connectedPeerName}` : `Payment request sent to ${connectedPeerName}`
      : selectedAsset === "USDC" ? "Approve final payment in your wallet." : "Payment request sent — check your wallet"
  } else if (baseMobileStep === "payment_submitted") {
    contextMessage = "Payment submitted"
  } else if (baseMobileStep === "network_confirmation") {
    contextMessage = "Waiting for network confirmation..."
  } else if (baseMobileStep === "fallback_required") {
    contextMessage = pendingWalletActionKind === "usdc_approve"
      ? "USDC authorization needs one more wallet action"
      : "Payment confirmation needs one more wallet action"
  }
  const walletRequestIsPending = walletRequestUiState === "opening_wallet" || walletRequestUiState === "awaiting_wallet" || walletRequestUiState === "request_sent"
  const activeWalletRequestKind = activeWalletRequestRef.current?.kind ?? pendingWalletRequestKind
  const showWalletPrompt =
    baseMobileStep === "payment_dispatching" ||
    baseMobileStep === "payment_in_wallet" ||
    baseMobileStep === "usdc_authorization_dispatching" ||
    baseMobileStep === "usdc_authorization_in_wallet" ||
    ((execStage === "confirm_payment" || execStage === "authorizing_usdc") && baseMobileStep !== "fallback_required") ||
    ((execStage === "connecting_wallet" || execStage === "asset_selected") && walletRequestIsPending)
  const showReturnHereHint =
    (execStage === "connecting_wallet" || execStage === "asset_selected") && !showWalletPrompt
  const walletRequestPrimaryCopy = activeWalletRequestKind === "connect"
    ? "Approve wallet connection"
    : activeWalletRequestKind === "usdc_approve"
      ? "USDC authorization"
      : activeWalletRequestKind === "usdc_signature"
        ? "Authorize USDC payment"
        : selectedAsset === "USDC"
          ? "Final payment approval"
          : "Payment approval"
  const walletRequestDetailCopy =
    activeWalletRequestKind === "usdc_signature"
      ? "PineTree will securely submit the payment after authorization."
      : baseMobileStep === "payment_in_wallet" || baseMobileStep === "usdc_authorization_in_wallet"
        ? "The request has been sent to your wallet. Open your wallet app to approve, then return here."
        : "Return here after approving in your wallet."
  const fallbackButtonCopy = pendingWalletActionKind === "usdc_approve"
    ? "Retry USDC authorization"
    : pendingWalletActionKind === "eth_payment" || pendingWalletActionKind === "usdc_payment"
      ? "Retry payment approval"
      : "Retry wallet approval"
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
              "USDC authorization",
              usdcAuthStatus,
              usdcAuthStatus === "active" ? "Approve USDC authorization in your wallet." : undefined
            ) : null}
            {renderStep(
              "Payment approval",
              confirmPayStatus,
              confirmPayStatus === "active" ? (selectedAsset === "USDC" ? "Approve final payment in your wallet." : "Approve in your wallet") : undefined
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
                    {walletRequestIsPending ? walletRequestDetailCopy : "Return here after approving in your wallet."}
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
                  Return here after approving in your wallet.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {execStage !== "payment_submitted" && execStage !== "detecting" && execStage !== "confirmed" ? (
          baseMobileStep === "fallback_required" && (walletHandoffPending || pendingWalletActionReady) && !isOpeningWallet && !pendingWalletActionInFlight ? (
            <Button
              fullWidth
              onClick={() => {
                void logBase("retry-wallet-approval-click", {
                  intentId: intentId || null,
                  selectedAsset,
                  walletRequestKind: pendingActionKindRef.current || pendingWalletRequestKind,
                  pendingWalletActionReady,
                })
                if (pendingActionKindRef.current) {
                  void dispatchPendingWalletActionRef.current?.("retry-wallet-approval-click")
                  return
                }
                triggerBaseAutoResumeRef.current?.("retry-wallet-approval-click")
              }}
            >
              {fallbackButtonCopy}
            </Button>
          ) : null
        ) : null}
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
      {selectedAsset === "USDC" && classifyWalletFamily(connectedPeerName ?? null) === "trust" ? (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Trust Wallet requires a one-time USDC authorization before payment.
        </div>
      ) : null}
      {isConnecting ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          Connecting wallet…
        </Button>
      ) : isPreparingPayment ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          {basePayStatus || "Preparing payment…"}
        </Button>
      ) : isOpeningWallet ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          {basePayStatus || "Waiting for wallet response..."}
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
