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

const SUPPORTED_ASSETS: Record<WalletWithdrawalRail, WalletWithdrawalAsset[]> = {
  base: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  bitcoin: ["BTC"],
}

const BASE_USDC_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

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
    provider: canSign ? "configured_signer" : null,
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

function getMerchantSafeWithdrawalError(error: unknown) {
  const raw = error instanceof Error ? error.message : ""
  if (!raw.trim()) return "The withdrawal could not be processed."
  return raw.replace(/private key|secret|api key|token|signer/gi, "provider")
}
