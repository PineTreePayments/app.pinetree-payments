import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  createWalletWithdrawalRequest,
  findOpenUnsignedWalletWithdrawalReview,
  getWalletWithdrawalRequest,
  updateWalletWithdrawalRequest,
  type WalletWithdrawalAsset,
  type WalletWithdrawalRail,
  type WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
import { insertWithdrawalAuditEvent } from "@/database/merchantAuditEvents"
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token"
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js"
import { encodeFunctionData, parseEther, parseUnits } from "viem"
import {
  buildBitcoinWithdrawalPsbt,
  finalizeAndBroadcastBitcoinPsbt,
  getBitcoinProviderConfig,
  validateBitcoinAddressForConfiguredNetwork,
} from "@/providers/wallets/bitcoinNetworkProvider"
import { getPineTreeSpeedConfigStatus } from "@/providers/lightning/speedClient"
import {
  createDefaultWithdrawalSigner,
  type WithdrawalReview,
  type WithdrawalSigner,
} from "@/providers/wallets/withdrawalSigner"
import { buildPineTreeRailReadiness } from "@/lib/pinetreeRailReadiness"

export type CreateWalletWithdrawalReviewInput = {
  rail: string
  asset: string
  destinationAddress: string
  amountDecimal: string
}

export type CreateWalletWithdrawalReviewResult = {
  request: WalletWithdrawalRequestRecord
  review: WithdrawalReview
  canSubmit: boolean
}

type WithdrawalFallbackDiagnostics = {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  railEnabled: boolean
  walletConnected: boolean
  walletAddressExists: boolean
  walletProfileAddressPresent: boolean
  savedSourceAddress: string | null
  matchingDynamicWallet: boolean
  browserWalletAddresses: string[]
  dynamicMethodAvailable: boolean
  addressMismatch: boolean
  btcBroadcastEnabled: boolean
  btcProviderConfigured: boolean
  speedPayoutAvailable: boolean
  fallbackReason: string | null
}

export type SubmitWalletWithdrawalResult = {
  request: WalletWithdrawalRequestRecord
  merchantStatus: "Processing" | "Withdrawal failed"
  message: string
}

export type PreparedDynamicWithdrawal = {
  request: WalletWithdrawalRequestRecord
  approvalMethod: "dynamic_browser"
  provider: "dynamic"
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  sourceAddress: string
  destinationAddress?: string
  amountSats?: number
  feeSats?: number
  changeSats?: number
  inputTotalSats?: number
  utxoCount?: number
  payload:
    | {
        kind: "evm_transaction"
        chainId: 8453
        from: string
        to: string
        value: `0x${string}`
        data: `0x${string}`
      }
    | {
        kind: "solana_transaction"
        network: "solana"
        from: string
        transactionBase64: string
      }
    | {
        kind: "bitcoin_psbt"
        network: "mainnet" | "testnet"
        from: string
        psbtBase64: string
        signInputs: Array<{
          address: string
          index: number
        }>
        sourceAddress: string
        destinationAddress: string
        amountSats: number
        feeSats: number
        changeSats: number
        inputTotalSats: number
        utxoCount: number
      }
}

export type CompleteDynamicWithdrawalInput = {
  txHash: string
  providerReference?: string | null
  signedPayload?: Record<string, unknown> | null
  signedPsbtBase64?: string | null
}

const SUPPORTED_ASSETS: Record<WalletWithdrawalRail, WalletWithdrawalAsset[]> = {
  base: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  bitcoin: ["BTC"],
}

const BASE_USDC_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const BASE_CHAIN_ID = "8453"
const BASE_USDC_TRANSFER_ABI = [{
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
}] as const

export const WALLET_WITHDRAWAL_VALIDATION_PATHS = {
  baseEth: { rail: "base", asset: "ETH", transfer: "native_eth" },
  baseUsdc: {
    rail: "base",
    asset: "USDC",
    transfer: "erc20_transfer",
    tokenAddress: BASE_USDC_TOKEN_ADDRESS,
    decimals: 6,
  },
  solanaSol: { rail: "solana", asset: "SOL", transfer: "system_transfer" },
  solanaUsdc: {
    rail: "solana",
    asset: "USDC",
    transfer: "spl_token_transfer",
    mint: SOLANA_USDC_MINT,
    decimals: 6,
  },
  bitcoinBtc: { rail: "bitcoin", asset: "BTC", transfer: "btc_wallet_provider" },
} as const

export function normalizeWithdrawalRail(value: string): WalletWithdrawalRail | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === "base" || normalized === "solana" || normalized === "bitcoin") return normalized
  return null
}

export function normalizeWithdrawalAsset(value: string): WalletWithdrawalAsset | null {
  const normalized = value.trim().toUpperCase()
  if (normalized === "ETH" || normalized === "USDC" || normalized === "SOL" || normalized === "BTC") {
    return normalized
  }
  return null
}

/**
 * Normalizes a user-supplied decimal amount string to a canonical form suitable
 * for storage and blockchain unit conversion. Adds a leading zero when needed
 * (.01 → 0.01) and rejects zero, negative, scientific notation, and non-numeric
 * input. Returns null for any value that cannot be a valid positive amount.
 */
export function normalizeWithdrawalAmount(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  // Scientific notation is not safe for blockchain amounts
  if (/[eE]/.test(trimmed)) return null
  // Reject explicit negative sign
  if (trimmed.startsWith("-")) return null
  // Add leading zero for bare decimal values (.01 → 0.01)
  const normalized = trimmed.startsWith(".") ? `0${trimmed}` : trimmed
  // Must be digits optionally followed by a decimal fraction
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const n = Number(normalized)
  if (!Number.isFinite(n) || n <= 0) return null
  return normalized
}

export function validateWalletWithdrawalInput(input: CreateWalletWithdrawalReviewInput): {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
} {
  const rail = normalizeWithdrawalRail(input.rail)
  const asset = normalizeWithdrawalAsset(input.asset)
  const destinationAddress = input.destinationAddress.trim()

  if (!rail) throw Object.assign(new Error("Unsupported withdrawal rail."), { status: 400 })
  if (!asset || !SUPPORTED_ASSETS[rail].includes(asset)) {
    throw Object.assign(new Error("Unsupported rail/asset combination."), { status: 400 })
  }
  if (!destinationAddress) {
    throw Object.assign(new Error("Destination address is required."), { status: 400 })
  }
  if (!isValidDestinationAddress(rail, destinationAddress)) {
    throw Object.assign(new Error("Destination address is invalid for the selected rail."), { status: 400 })
  }

  const amountDecimal = normalizeWithdrawalAmount(input.amountDecimal)
  if (amountDecimal === null) {
    const raw = Number(String(input.amountDecimal).trim())
    if (Number.isFinite(raw) && raw <= 0) {
      throw Object.assign(new Error("Enter an amount greater than 0."), { status: 400 })
    }
    throw Object.assign(new Error("Enter a valid withdrawal amount."), { status: 400 })
  }

  return { rail, asset, destinationAddress, amountDecimal }
}

function isValidDestinationAddress(rail: WalletWithdrawalRail, address: string) {
  if (rail === "base") return /^0x[a-fA-F0-9]{40}$/.test(address)
  if (rail === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
  return validateBitcoinAddressForConfiguredNetwork(address)
}

export async function createWalletWithdrawalReview(
  merchantId: string,
  input: CreateWalletWithdrawalReviewInput,
  signer: WithdrawalSigner = createDefaultWithdrawalSigner()
): Promise<CreateWalletWithdrawalReviewResult> {
  const validated = validateWalletWithdrawalInput(input)
  const [profile, providers, lightningProfile] = await Promise.all([
    getPineTreeWalletProfile(merchantId),
    import("@/database/merchants").then((mod) => mod.getMerchantProviders(merchantId)).catch(() => []),
    import("@/database/merchantLightningProfiles").then((mod) => mod.getMerchantLightningProfile(merchantId)).catch(() => null),
  ])
  const { SPEED_PROVIDER_NAME } = await import("@/database/merchantProviders").catch(() => ({ SPEED_PROVIDER_NAME: "lightning_speed" }))
  if (!profile) {
    throw Object.assign(new Error("PineTree Wallet profile not found."), { status: 404 })
  }

  const readinessProviders = providers.length
    ? providers
    : [
        { provider: "solana", enabled: true, status: "connected" },
        { provider: "base", enabled: true, status: "connected" },
        { provider: SPEED_PROVIDER_NAME, enabled: true, status: "connected" },
      ]
  const speedProvider = readinessProviders.find((provider) => String(provider.provider || "").toLowerCase().trim() === SPEED_PROVIDER_NAME) as {
    credentials?: unknown
    status?: string | null
  } | undefined
  const speedCredentials = (speedProvider?.credentials || {}) as {
    speed_account_id?: string
    account_id?: string
    setup_status?: string
  }
  const speedConfig = getPineTreeSpeedConfigStatus()
  const speedAccountReady = Boolean(
    lightningProfile?.status === "ready" ||
    (
      String(speedCredentials.speed_account_id || speedCredentials.account_id || "").trim() &&
      (String(speedCredentials.setup_status || "").trim() === "ready" ||
        String(speedCredentials.setup_status || "").trim() === "ready_for_payments")
    )
  )
  const railReadiness = buildPineTreeRailReadiness({
    providers: readinessProviders,
    walletProfile: profile,
    speed: {
      configured: speedConfig.configured,
      accountReady: speedAccountReady,
      payoutReady: Boolean(speedAccountReady && profile.btc_payout_enabled),
      status: lightningProfile?.status || String(speedCredentials.setup_status || "")
    }
  })
  const readinessKey = validated.rail === "bitcoin" ? "bitcoin_lightning" : validated.rail
  const readiness = railReadiness[readinessKey]
  if (!readiness.enabled) {
    throw Object.assign(new Error("This withdrawal rail is disabled."), { status: 409 })
  }
  if (validated.rail === "bitcoin" && !readiness.withdrawalReady) {
    throw Object.assign(new Error("Bitcoin payouts are not ready for this merchant."), { status: 409 })
  }
  if (!readiness.walletProvisioned) {
    throw Object.assign(new Error("PineTree Wallet source address is not available."), { status: 409 })
  }

  const signerInput = {
    merchantId,
    walletProfileId: profile.id,
    ...validated,
  }
  const [signerCanSign, signerReview] = await Promise.all([
    signer.canSignWithdrawal(signerInput),
    signer.createWithdrawalReview(signerInput),
  ])
  const sourceAddress = getSourceAddressForRailOrNull(profile, validated.rail)
  const bitcoinConfig = getBitcoinProviderConfig()
  const canSign = signerCanSign && Boolean(sourceAddress)
  console.info("[wallet-withdrawal] review decision", {
    merchantId,
    rail: validated.rail,
    asset: validated.asset,
    signerCanSign,
    sourceAddressPresent: Boolean(sourceAddress),
    canSign,
    approvalMethod: canSign ? "dynamic_browser" : "manual_review",
  })
  const diagnostics = buildWithdrawalDiagnostics({
    rail: validated.rail,
    asset: validated.asset,
    sourceAddress,
    signerCanSign,
    bitcoinProviderConfigured: Boolean(bitcoinConfig),
    bitcoinBroadcastEnabled: Boolean(bitcoinConfig?.broadcastEnabled),
  })
  const review: WithdrawalReview = {
    ...signerReview,
    signerEnabled: canSign,
    approvalMethod: canSign ? "dynamic_browser" : "manual_review",
    estimatedStatus: canSign ? "Ready to submit" : "Signer unavailable",
    message: canSign
      ? "Review this withdrawal before submitting."
      : "PineTree Wallet signer is not available for this asset yet.",
    diagnostics,
  }

  const existingOpenReview = await findOpenUnsignedWalletWithdrawalReview({
    merchantId,
    rail: validated.rail,
    asset: validated.asset,
    destinationAddress: validated.destinationAddress,
    amountDecimal: validated.amountDecimal,
  })

  const request = existingOpenReview
    ? await updateWalletWithdrawalRequest(merchantId, existingOpenReview.id, {
        status: "review_required",
        provider: canSign && review.approvalMethod === "dynamic_browser" ? "dynamic" : null,
        providerReference: null,
        txHash: null,
        unsignedTransactionPayload: null,
        signedPayload: null,
        approvalMethod: review.approvalMethod || (canSign ? "dynamic_browser" : "manual_review"),
        chainId: null,
        tokenContract: null,
        tokenMint: null,
        reviewPayload: {
          ...review,
          diagnostics,
        },
        errorMessage: null,
      })
    : await createWalletWithdrawalRequest({
    merchantId,
    walletProfileId: profile.id,
    ...validated,
    status: "review_required",
    provider: canSign && review.approvalMethod === "dynamic_browser" ? "dynamic" : null,
    approvalMethod: review.approvalMethod || (canSign ? "dynamic_browser" : "manual_review"),
    reviewPayload: {
      ...review,
      diagnostics,
    },
    errorMessage: null,
  })

  void insertWithdrawalAuditEvent({
    merchantId,
    eventType: "withdrawal.review_created",
    withdrawalId: request.id,
    rail: validated.rail,
    asset: validated.asset,
    status: request.status,
    metadata: { approval_method: review.approvalMethod, can_submit: canSign, reused: Boolean(existingOpenReview) },
  })

  return {
    request,
    review,
    canSubmit: canSign,
  }
}

export async function submitWalletWithdrawalRequest(
  merchantId: string,
  withdrawalId: string,
  signer: WithdrawalSigner = createDefaultWithdrawalSigner()
): Promise<SubmitWalletWithdrawalResult> {
  const request = await getWalletWithdrawalRequest(merchantId, withdrawalId)
  if (!request) {
    throw Object.assign(new Error("Withdrawal request not found."), { status: 404 })
  }

  const validated = validateWalletWithdrawalInput({
    rail: request.rail,
    asset: request.asset,
    destinationAddress: request.destination_address,
    amountDecimal: request.amount_decimal,
  })
  const canSign = await signer.canSignWithdrawal({
    merchantId,
    walletProfileId: request.wallet_profile_id,
    ...validated,
  })

  if (request.approval_method === "dynamic_browser") {
    // This withdrawal requires browser-side wallet signing via the prepare → sign → complete path.
    // submitWalletWithdrawalRequest must not be called for dynamic_browser requests; the client
    // should POST to /prepare, sign with Dynamic, then POST to /submit.
    console.info("[wallet-withdrawal] dynamic_browser submit rejected — use prepare/sign/complete path", {
      withdrawalId: request.id,
      merchantId,
      rail: request.rail,
      asset: request.asset,
    })
    throw Object.assign(
      new Error("This withdrawal must use the PineTree Wallet signer path."),
      { status: 409 }
    )
  }

  if (!canSign) {
    throw Object.assign(
      new Error("PineTree Wallet signer is not available for this asset yet."),
      { status: 422 }
    )
  }

  await updateWalletWithdrawalRequest(merchantId, request.id, {
    status: "pending",
    errorMessage: null,
  })

  const processing = await updateWalletWithdrawalRequest(merchantId, request.id, {
    status: "processing",
    errorMessage: null,
  })

  try {
    const submitted = await signer.submitWithdrawal({ request: processing })
    const accepted = await updateWalletWithdrawalRequest(merchantId, request.id, {
      status: "processing",
      provider: submitted.provider,
      providerReference: submitted.providerReference,
      txHash: submitted.txHash || null,
      errorMessage: null,
    })
    void insertWithdrawalAuditEvent({
      merchantId,
      eventType: "withdrawal.processing",
      withdrawalId: request.id,
      rail: request.rail,
      asset: request.asset,
      status: "processing",
      metadata: { tx_hash: submitted.txHash || null, provider: submitted.provider },
    })
    return {
      request: accepted,
      merchantStatus: "Processing",
      message: "Withdrawal submitted.",
    }
  } catch (error) {
    const failed = await updateWalletWithdrawalRequest(merchantId, request.id, {
      status: "failed",
      errorMessage: getMerchantSafeWithdrawalError(error),
    })
    void insertWithdrawalAuditEvent({
      merchantId,
      eventType: "withdrawal.failed",
      withdrawalId: request.id,
      rail: request.rail,
      asset: request.asset,
      status: "failed",
    })
    return {
      request: failed,
      merchantStatus: "Withdrawal failed",
      message: "Withdrawal failed.",
    }
  }
}

export async function prepareDynamicWalletWithdrawal(
  merchantId: string,
  withdrawalId: string
): Promise<PreparedDynamicWithdrawal> {
  const request = await getWalletWithdrawalRequest(merchantId, withdrawalId)
  if (!request) {
    throw Object.assign(new Error("Withdrawal request not found."), { status: 404 })
  }
  const hasReusablePreparedPayload =
    request.status === "pending" &&
    request.unsigned_transaction_payload &&
    !request.tx_hash

  if (request.status !== "review_required" && !hasReusablePreparedPayload) {
    throw Object.assign(new Error("Withdrawal request is not ready for wallet approval."), { status: 409 })
  }
  if (request.approval_method !== "dynamic_browser" || request.provider !== "dynamic") {
    throw Object.assign(new Error("Withdrawal request is pending review."), { status: 409 })
  }

  const profile = await getPineTreeWalletProfile(merchantId)
  if (!profile || profile.id !== request.wallet_profile_id) {
    throw Object.assign(new Error("PineTree Wallet profile not found."), { status: 404 })
  }

  const validated = validateWalletWithdrawalInput({
    rail: request.rail,
    asset: request.asset,
    destinationAddress: request.destination_address,
    amountDecimal: request.amount_decimal,
  })
  const sourceAddress = getSourceAddressForRail(profile, validated.rail)

  if (hasReusablePreparedPayload) {
    assertPreparedPayloadUsesSavedSource(request.unsigned_transaction_payload!, sourceAddress)
    return {
      request,
      approvalMethod: "dynamic_browser",
      provider: "dynamic",
      rail: validated.rail,
      asset: validated.asset,
      sourceAddress,
      payload: request.unsigned_transaction_payload! as PreparedDynamicWithdrawal["payload"],
    }
  }

  const prepared = await buildDynamicWithdrawalPayload({
    ...validated,
    sourceAddress,
    sourceAddressType: validated.rail === "bitcoin" ? profile.btc_address_type : null,
  })

  const updated = await updateWalletWithdrawalRequest(merchantId, request.id, {
    status: "pending",
    provider: "dynamic",
    unsignedTransactionPayload: prepared.payload,
    approvalMethod: "dynamic_browser",
    chainId:
      prepared.rail === "base"
        ? BASE_CHAIN_ID
        : prepared.payload.kind === "bitcoin_psbt"
          ? `bitcoin-${prepared.payload.network}`
          : null,
    tokenContract: prepared.rail === "base" && prepared.asset === "USDC" ? BASE_USDC_TOKEN_ADDRESS : null,
    tokenMint: prepared.rail === "solana" && prepared.asset === "USDC" ? SOLANA_USDC_MINT : null,
    reviewPayload: {
      ...request.review_payload,
      ...(prepared.payload.kind === "bitcoin_psbt" ? {
        fee_sats: prepared.feeSats,
        change_sats: prepared.changeSats,
        input_total_sats: prepared.inputTotalSats,
        utxo_count: prepared.utxoCount,
        source_address: prepared.sourceAddress,
        destination_address: prepared.destinationAddress,
        amount_sats: prepared.amountSats,
      } : {}),
    },
    errorMessage: null,
  })

  return {
    request: updated,
    approvalMethod: "dynamic_browser",
    provider: "dynamic",
    rail: prepared.rail,
    asset: prepared.asset,
    sourceAddress: prepared.sourceAddress,
    destinationAddress: prepared.destinationAddress,
    amountSats: prepared.amountSats,
    feeSats: prepared.feeSats,
    changeSats: prepared.changeSats,
    inputTotalSats: prepared.inputTotalSats,
    utxoCount: prepared.utxoCount,
    payload: prepared.payload,
  }
}

export async function completeDynamicWalletWithdrawal(
  merchantId: string,
  withdrawalId: string,
  input: CompleteDynamicWithdrawalInput
): Promise<SubmitWalletWithdrawalResult> {
  const request = await getWalletWithdrawalRequest(merchantId, withdrawalId)
  if (!request) {
    throw Object.assign(new Error("Withdrawal request not found."), { status: 404 })
  }
  if (request.approval_method !== "dynamic_browser" || request.provider !== "dynamic") {
    throw Object.assign(new Error("Withdrawal request is pending review."), { status: 409 })
  }
  if (!request.unsigned_transaction_payload) {
    throw Object.assign(new Error("Withdrawal request has not been prepared for wallet approval."), { status: 409 })
  }
  const profile = await getPineTreeWalletProfile(merchantId)
  if (!profile || profile.id !== request.wallet_profile_id) {
    throw Object.assign(new Error("PineTree Wallet profile not found."), { status: 404 })
  }
  const sourceAddress = getSourceAddressForRail(profile, request.rail)
  assertPreparedPayloadUsesSavedSource(request.unsigned_transaction_payload, sourceAddress)
  const dynamicWalletAddress = String(input.signedPayload?.dynamic_wallet_address || "").trim()
  if (dynamicWalletAddress && dynamicWalletAddress.toLowerCase() !== sourceAddress.toLowerCase()) {
    throw Object.assign(new Error("Wallet approval does not match the PineTree Wallet source address."), { status: 400 })
  }

  if (request.rail === "bitcoin") {
    const signedPsbtBase64 = String(input.signedPsbtBase64 || input.signedPayload?.signedPsbt || "").trim()
    if (!signedPsbtBase64) {
      throw Object.assign(new Error("Signed Bitcoin PSBT is required."), { status: 400 })
    }
    const broadcast = await finalizeAndBroadcastBitcoinPsbt({
      signedPsbtBase64,
      preparedPayload: request.unsigned_transaction_payload,
    })
    const updated = await updateWalletWithdrawalRequest(merchantId, request.id, {
      status: "processing",
      provider: "dynamic",
      providerReference: input.providerReference?.trim() || broadcast.txid,
      txHash: broadcast.txid,
      signedPayload: {
        signedPsbtBase64,
        rawTxHex: broadcast.rawTxHex,
      },
      errorMessage: null,
    })
    void insertWithdrawalAuditEvent({
      merchantId,
      eventType: "withdrawal.processing",
      withdrawalId: request.id,
      rail: request.rail,
      asset: request.asset,
      status: "processing",
      metadata: { tx_hash: broadcast.txid, provider: "dynamic" },
    })
    return {
      request: updated,
      merchantStatus: "Processing",
      message: "Withdrawal submitted.",
    }
  }

  const txHash = input.txHash.trim()
  if (!isValidTransactionHash(request.rail, txHash)) {
    throw Object.assign(new Error("Transaction reference is invalid for the selected rail."), { status: 400 })
  }

  const updated = await updateWalletWithdrawalRequest(merchantId, request.id, {
    status: "processing",
    provider: "dynamic",
    providerReference: input.providerReference?.trim() || txHash,
    txHash,
    signedPayload: input.signedPayload || null,
    errorMessage: null,
  })

  void insertWithdrawalAuditEvent({
    merchantId,
    eventType: "withdrawal.processing",
    withdrawalId: request.id,
    rail: request.rail,
    asset: request.asset,
    status: "processing",
    metadata: { tx_hash: txHash, provider: "dynamic" },
  })

  return {
    request: updated,
    merchantStatus: "Processing",
    message: "Withdrawal submitted.",
  }
}

function getSourceAddressForRail(
  profile: Awaited<ReturnType<typeof getPineTreeWalletProfile>>,
  rail: WalletWithdrawalRail
) {
  if (!profile) throw Object.assign(new Error("PineTree Wallet profile not found."), { status: 404 })
  const sourceAddress =
    rail === "base"
      ? profile.base_address
      : rail === "solana"
        ? profile.solana_address
        : profile.btc_address || profile.bitcoin_onchain_address

  if (!sourceAddress) {
    throw Object.assign(new Error("PineTree Wallet source address is not available."), { status: 409 })
  }
  return sourceAddress
}

function getSourceAddressForRailOrNull(
  profile: Awaited<ReturnType<typeof getPineTreeWalletProfile>>,
  rail: WalletWithdrawalRail
) {
  try {
    return getSourceAddressForRail(profile, rail)
  } catch {
    return null
  }
}

function buildWithdrawalDiagnostics(input: {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  sourceAddress: string | null
  signerCanSign: boolean
  bitcoinProviderConfigured: boolean
  bitcoinBroadcastEnabled: boolean
}): WithdrawalFallbackDiagnostics {
  const diagnostics: WithdrawalFallbackDiagnostics = {
    rail: input.rail,
    asset: input.asset,
    railEnabled: true,
    walletConnected: Boolean(input.sourceAddress),
    walletAddressExists: Boolean(input.sourceAddress),
    walletProfileAddressPresent: Boolean(input.sourceAddress),
    savedSourceAddress: input.sourceAddress,
    matchingDynamicWallet: input.signerCanSign,
    browserWalletAddresses: [],
    dynamicMethodAvailable: input.signerCanSign,
    addressMismatch: false,
    btcBroadcastEnabled: input.bitcoinBroadcastEnabled,
    btcProviderConfigured: input.bitcoinProviderConfigured,
    speedPayoutAvailable: false,
    fallbackReason: null,
  }

  if (!diagnostics.walletProfileAddressPresent) diagnostics.fallbackReason = "source_wallet_missing"
  else if (input.rail === "bitcoin" && !diagnostics.btcProviderConfigured) diagnostics.fallbackReason = "btc_provider_missing"
  else if (input.rail === "bitcoin" && !diagnostics.btcBroadcastEnabled) diagnostics.fallbackReason = "btc_broadcast_disabled"
  else if (!diagnostics.matchingDynamicWallet) diagnostics.fallbackReason = "dynamic_wallet_unavailable"
  else if (!diagnostics.dynamicMethodAvailable) diagnostics.fallbackReason = "dynamic_method_unavailable"

  return diagnostics
}

async function buildDynamicWithdrawalPayload(input: {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
  sourceAddress: string
  sourceAddressType?: string | null
}): Promise<Omit<PreparedDynamicWithdrawal, "request" | "approvalMethod" | "provider">> {
  if (input.rail === "bitcoin") {
    if (input.asset !== "BTC") {
      throw Object.assign(new Error("Unsupported rail/asset combination."), { status: 400 })
    }
    const prepared = await buildBitcoinWithdrawalPsbt({
      sourceAddress: input.sourceAddress,
      sourceAddressType: input.sourceAddressType,
      destinationAddress: input.destinationAddress,
      amountDecimal: input.amountDecimal,
    })
    return {
      rail: input.rail,
      asset: input.asset,
      sourceAddress: input.sourceAddress,
      destinationAddress: input.destinationAddress,
      amountSats: prepared.amountSats,
      feeSats: prepared.feeSats,
      changeSats: prepared.changeSats,
      inputTotalSats: prepared.inputTotalSats,
      utxoCount: prepared.utxoCount,
      payload: {
        kind: "bitcoin_psbt",
        network: prepared.network,
        from: input.sourceAddress,
        psbtBase64: prepared.psbtBase64,
        signInputs: prepared.selectedUtxos.map((_, index) => ({
          address: input.sourceAddress,
          index,
        })),
        sourceAddress: input.sourceAddress,
        destinationAddress: input.destinationAddress,
        amountSats: prepared.amountSats,
        feeSats: prepared.feeSats,
        changeSats: prepared.changeSats,
        inputTotalSats: prepared.inputTotalSats,
        utxoCount: prepared.utxoCount,
      },
    }
  }
  if (input.rail === "base") {
    return {
      rail: input.rail,
      asset: input.asset,
      sourceAddress: input.sourceAddress,
      payload: buildBaseWithdrawalPayload(input),
    }
  }
  return {
    rail: input.rail,
    asset: input.asset,
    sourceAddress: input.sourceAddress,
    payload: await buildSolanaWithdrawalPayload(input),
  }
}

function buildBaseWithdrawalPayload(input: {
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
  sourceAddress: string
}): PreparedDynamicWithdrawal["payload"] {
  if (input.asset === "ETH") {
    return {
      kind: "evm_transaction",
      chainId: 8453,
      from: input.sourceAddress,
      to: input.destinationAddress,
      value: `0x${parseEther(input.amountDecimal).toString(16)}`,
      data: "0x",
    }
  }
  if (input.asset !== "USDC") {
    throw Object.assign(new Error("Unsupported rail/asset combination."), { status: 400 })
  }
  const amount = parseUnits(input.amountDecimal, 6)
  return {
    kind: "evm_transaction",
    chainId: 8453,
    from: input.sourceAddress,
    to: BASE_USDC_TOKEN_ADDRESS,
    value: "0x0",
    data: encodeFunctionData({
      abi: BASE_USDC_TRANSFER_ABI,
      functionName: "transfer",
      args: [input.destinationAddress as `0x${string}`, amount],
    }),
  }
}

async function buildSolanaWithdrawalPayload(input: {
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
  sourceAddress: string
}): Promise<PreparedDynamicWithdrawal["payload"]> {
  const source = new PublicKey(input.sourceAddress)
  const destination = new PublicKey(input.destinationAddress)
  const connection = new Connection(getSolanaRpcUrl(), "confirmed")
  const transaction = new Transaction()
  transaction.feePayer = source
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash

  if (input.asset === "SOL") {
    transaction.add(SystemProgram.transfer({
      fromPubkey: source,
      toPubkey: destination,
      lamports: parseSolanaUnits(input.amountDecimal, 9),
    }))
  } else if (input.asset === "USDC") {
    const mint = new PublicKey(SOLANA_USDC_MINT)
    const sourceAta = await getAssociatedTokenAddress(mint, source)
    const destinationAta = await getAssociatedTokenAddress(mint, destination)
    const destinationInfo = await connection.getAccountInfo(destinationAta)
    if (!destinationInfo) {
      transaction.add(createAssociatedTokenAccountInstruction(
        source,
        destinationAta,
        destination,
        mint,
      ))
    }
    transaction.add(createTransferCheckedInstruction(
      sourceAta,
      mint,
      destinationAta,
      source,
      parseSolanaUnits(input.amountDecimal, 6),
      6,
    ))
  } else {
    throw Object.assign(new Error("Unsupported rail/asset combination."), { status: 400 })
  }

  return {
    kind: "solana_transaction",
    network: "solana",
    from: input.sourceAddress,
    transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
  }
}

function parseSolanaUnits(value: string, decimals: number): bigint {
  const raw = value.trim()
  // Normalize leading-dot format (.01 → 0.01) before parsing
  const trimmed = raw.startsWith(".") ? `0${raw}` : raw
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw Object.assign(new Error("Enter a valid withdrawal amount."), { status: 400 })
  }
  const [whole, fraction = ""] = trimmed.split(".")
  if (fraction.length > decimals) {
    throw Object.assign(new Error("Withdrawal amount has too many decimal places."), { status: 400 })
  }
  return BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt((fraction.padEnd(decimals, "0") || "0"))
}

function getSolanaRpcUrl() {
  return (
    process.env.RPC_URL_SOLANA ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  )
}

function isValidTransactionHash(rail: WalletWithdrawalRail, hash: string) {
  if (rail === "base") return /^0x[a-fA-F0-9]{64}$/.test(hash)
  if (rail === "solana") return /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(hash)
  return /^[a-fA-F0-9]{64}$/.test(hash)
}

function assertPreparedPayloadUsesSavedSource(payload: Record<string, unknown>, sourceAddress: string) {
  const kind = String(payload.kind || "")
  const preparedSource =
    kind === "evm_transaction"
      ? String(payload.from || "")
      : kind === "solana_transaction"
        ? String(payload.from || "")
        : kind === "bitcoin_psbt"
          ? String(payload.sourceAddress || payload.from || "")
          : ""
  if (!preparedSource || preparedSource.toLowerCase() !== sourceAddress.toLowerCase()) {
    throw Object.assign(new Error("Prepared withdrawal source does not match the PineTree Wallet profile."), { status: 400 })
  }
}

function getMerchantSafeWithdrawalError(error: unknown) {
  const raw = error instanceof Error ? error.message : ""
  if (!raw.trim()) return "The withdrawal could not be processed."
  return raw.replace(/private key|secret|api key|token|signer/gi, "provider")
}
