import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  createWalletWithdrawalRequest,
  getWalletWithdrawalRequest,
  updateWalletWithdrawalRequest,
  type WalletWithdrawalAsset,
  type WalletWithdrawalRail,
  type WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
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
  createDefaultWithdrawalSigner,
  type WithdrawalReview,
  type WithdrawalSigner,
} from "@/providers/wallets/withdrawalSigner"

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

export type SubmitWalletWithdrawalResult = {
  request: WalletWithdrawalRequestRecord
  merchantStatus: "Pending review" | "Processing" | "Withdrawal failed"
  message: string
}

export type PreparedDynamicWithdrawal = {
  request: WalletWithdrawalRequestRecord
  approvalMethod: "dynamic_browser"
  provider: "dynamic"
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  sourceAddress: string
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
        from: string
        transactionBase64: string
      }
}

export type CompleteDynamicWithdrawalInput = {
  txHash: string
  providerReference?: string | null
  signedPayload?: Record<string, unknown> | null
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

export function validateWalletWithdrawalInput(input: CreateWalletWithdrawalReviewInput): {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
} {
  const rail = normalizeWithdrawalRail(input.rail)
  const asset = normalizeWithdrawalAsset(input.asset)
  const destinationAddress = input.destinationAddress.trim()
  const amountDecimal = input.amountDecimal.trim()
  const amount = Number(amountDecimal)

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
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("Withdrawal amount must be positive."), { status: 400 })
  }

  return { rail, asset, destinationAddress, amountDecimal }
}

function isValidDestinationAddress(rail: WalletWithdrawalRail, address: string) {
  if (rail === "base") return /^0x[a-fA-F0-9]{40}$/.test(address)
  if (rail === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
  return /^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{20,90}$/i.test(address)
}

export async function createWalletWithdrawalReview(
  merchantId: string,
  input: CreateWalletWithdrawalReviewInput,
  signer: WithdrawalSigner = createDefaultWithdrawalSigner()
): Promise<CreateWalletWithdrawalReviewResult> {
  const validated = validateWalletWithdrawalInput(input)
  const profile = await getPineTreeWalletProfile(merchantId)
  if (!profile) {
    throw Object.assign(new Error("PineTree Wallet profile not found."), { status: 404 })
  }

  const signerInput = {
    merchantId,
    walletProfileId: profile.id,
    ...validated,
  }
  const [canSign, review] = await Promise.all([
    signer.canSignWithdrawal(signerInput),
    signer.createWithdrawalReview(signerInput),
  ])

  const request = await createWalletWithdrawalRequest({
    merchantId,
    walletProfileId: profile.id,
    ...validated,
    status: "review_required",
    provider: canSign && review.approvalMethod === "dynamic_browser" ? "dynamic" : null,
    approvalMethod: review.approvalMethod || (canSign ? "dynamic_browser" : "manual_review"),
    reviewPayload: review,
    errorMessage: null,
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
    const pendingReview = await updateWalletWithdrawalRequest(merchantId, request.id, {
      status: "review_required",
      errorMessage: null,
      reviewPayload: {
        ...request.review_payload,
        merchant_status: "Pending review",
      },
    })
    return {
      request: pendingReview,
      merchantStatus: "Pending review",
      message: "Withdrawal request submitted. We'll review this withdrawal before processing.",
    }
  }

  if (!canSign) {
    const pendingReview = await updateWalletWithdrawalRequest(merchantId, request.id, {
      status: "review_required",
      errorMessage: null,
      reviewPayload: {
        ...request.review_payload,
        merchant_status: "Pending review",
      },
    })
    return {
      request: pendingReview,
      merchantStatus: "Pending review",
      message: "Withdrawal request submitted. We'll review this withdrawal before processing.",
    }
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
  if (request.status !== "review_required") {
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

  const prepared = await buildDynamicWithdrawalPayload({
    ...validated,
    sourceAddress: getSourceAddressForRail(profile, validated.rail),
  })

  const updated = await updateWalletWithdrawalRequest(merchantId, request.id, {
    status: "pending",
    provider: "dynamic",
    unsignedTransactionPayload: prepared.payload,
    approvalMethod: "dynamic_browser",
    chainId: prepared.rail === "base" ? BASE_CHAIN_ID : null,
    tokenContract: prepared.rail === "base" && prepared.asset === "USDC" ? BASE_USDC_TOKEN_ADDRESS : null,
    tokenMint: prepared.rail === "solana" && prepared.asset === "USDC" ? SOLANA_USDC_MINT : null,
    errorMessage: null,
  })

  return {
    request: updated,
    approvalMethod: "dynamic_browser",
    provider: "dynamic",
    rail: prepared.rail,
    asset: prepared.asset,
    sourceAddress: prepared.sourceAddress,
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

async function buildDynamicWithdrawalPayload(input: {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
  sourceAddress: string
}): Promise<Omit<PreparedDynamicWithdrawal, "request" | "approvalMethod" | "provider">> {
  if (input.rail === "bitcoin") {
    throw Object.assign(new Error("Withdrawal request is pending review."), { status: 409 })
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
    from: input.sourceAddress,
    transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
  }
}

function parseSolanaUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw Object.assign(new Error("Withdrawal amount must be positive."), { status: 400 })
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

function getMerchantSafeWithdrawalError(error: unknown) {
  const raw = error instanceof Error ? error.message : ""
  if (!raw.trim()) return "The withdrawal could not be processed."
  return raw.replace(/private key|secret|api key|token|signer/gi, "provider")
}
