import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  createWalletWithdrawalRequest,
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

const SUPPORTED_ASSETS: Record<WalletWithdrawalRail, WalletWithdrawalAsset[]> = {
  base: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  bitcoin: ["BTC"],
}

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
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("Withdrawal amount must be positive."), { status: 400 })
  }

  return { rail, asset, destinationAddress, amountDecimal }
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
    status: canSign ? "review_required" : "blocked",
    provider: canSign ? "configured_signer" : null,
    reviewPayload: review,
    errorMessage: canSign ? null : "Signing not enabled yet",
  })

  return {
    request,
    review,
    canSubmit: canSign,
  }
}
