import type {
  WalletWithdrawalAsset,
  WalletWithdrawalRail,
  WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
import { findInFlightOrCompletedWithdrawalForDestination } from "@/database/walletWithdrawalRequests"
import { isBitcoinWithdrawalExecutionConfigured, parseBtcToSats } from "@/providers/wallets/bitcoinNetworkProvider"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"
import { isDynamicBtcLegacyEnabled } from "@/lib/pinetreeDynamicBtcLegacy"
import { createConnectedAccountWithdrawal } from "@/providers/lightning/speedWalletManagement"
import { resolveSpeedConnectedAccountContext } from "@/providers/lightning/speedConnectedAccountContext"

export type WithdrawalSignerInput = {
  merchantId: string
  walletProfileId: string | null
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
}

export type WithdrawalReview = {
  rail: WalletWithdrawalRail
  asset: WalletWithdrawalAsset
  destinationAddress: string
  amountDecimal: string
  signerEnabled: boolean
  approvalMethod?: "dynamic_browser" | "manual_review"
  estimatedStatus: "Ready to submit" | "Signer unavailable" | "Processing"
  message: string
  diagnostics?: Record<string, unknown>
}

export interface WithdrawalSigner {
  canSignWithdrawal(input: WithdrawalSignerInput): Promise<boolean>
  createWithdrawalReview(input: WithdrawalSignerInput): Promise<WithdrawalReview>
  submitWithdrawal(input: {
    request: WalletWithdrawalRequestRecord
  }): Promise<{ provider: string; providerReference: string; txHash?: string | null }>
}

export function disabledWithdrawalSigner(): WithdrawalSigner {
  return {
    async canSignWithdrawal() {
      return false
    },
    async createWithdrawalReview(input) {
      return {
        rail: input.rail,
        asset: input.asset,
        destinationAddress: input.destinationAddress,
        amountDecimal: input.amountDecimal,
        signerEnabled: false,
        approvalMethod: "manual_review",
        estimatedStatus: "Signer unavailable",
        message: "PineTree Wallet signer is not available for this asset yet.",
      }
    },
    async submitWithdrawal() {
      throw new Error("Withdrawal signer is disabled")
    },
  }
}

function dynamicEnvironmentConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim())
}

export function dynamicBrowserWithdrawalSigner(): WithdrawalSigner {
  return {
    async canSignWithdrawal(input) {
      return dynamicEnvironmentConfigured() && (
        input.rail === "base" ||
        input.rail === "solana" ||
        (
          input.rail === "bitcoin" &&
          input.asset === "BTC" &&
          isDynamicBtcLegacyEnabled() &&
          isBitcoinWithdrawalExecutionConfigured()
        )
      )
    },
    async createWithdrawalReview(input) {
      const canSign = await this.canSignWithdrawal(input)
      return {
        rail: input.rail,
        asset: input.asset,
        destinationAddress: input.destinationAddress,
        amountDecimal: input.amountDecimal,
        signerEnabled: canSign,
        approvalMethod: canSign ? "dynamic_browser" : "manual_review",
        estimatedStatus: canSign ? "Ready to submit" : "Signer unavailable",
        message: canSign
          ? "Review this withdrawal before submitting."
          : "PineTree Wallet signer is not available for this asset yet.",
      }
    },
    async submitWithdrawal() {
      throw new Error("Dynamic browser approval requires merchant wallet signing")
    },
  }
}

async function resolveReadySpeedAccountId(merchantId: string): Promise<string | null> {
  try {
    return (await resolveSpeedConnectedAccountContext(merchantId)).connectedAccountId
  } catch {
    return null
  }
}

/**
 * Executes Bitcoin/Lightning withdrawals through the merchant's connected
 * Speed account via Instant Send - no browser wallet signature is needed
 * (Speed executes server-side against the merchant's custodial balance), so
 * this never advertises "dynamic_browser". It reuses "manual_review" as the
 * WithdrawalReview.approvalMethod purely to satisfy the existing type/UI
 * contract (Base/Solana already treat non-dynamic_browser as "submit
 * immediately when signerEnabled is true") - this is not a human-reviewed
 * queue for Bitcoin.
 */
export function speedConnectedAccountWithdrawalSigner(): WithdrawalSigner {
  return {
    async canSignWithdrawal(input) {
      if (input.rail !== "bitcoin" || input.asset !== "BTC") return false
      if (!classifyBitcoinWithdrawalDestination(input.destinationAddress).valid) return false
      return Boolean(await resolveReadySpeedAccountId(input.merchantId))
    },
    async createWithdrawalReview(input) {
      const canSign = await this.canSignWithdrawal(input)
      return {
        rail: input.rail,
        asset: input.asset,
        destinationAddress: input.destinationAddress,
        amountDecimal: input.amountDecimal,
        signerEnabled: canSign,
        approvalMethod: "manual_review",
        estimatedStatus: canSign ? "Ready to submit" : "Signer unavailable",
        message: canSign
          ? "Review this withdrawal before submitting."
          : "Bitcoin withdrawals require a connected, ready Speed account.",
      }
    },
    async submitWithdrawal({ request }) {
      const speedAccountId = await resolveReadySpeedAccountId(request.merchant_id)
      if (!speedAccountId) {
        throw new Error("Speed connected account is not available.")
      }
      const classified = classifyBitcoinWithdrawalDestination(request.destination_address)
      if (!classified.valid) {
        throw new Error("Destination is invalid for this Bitcoin withdrawal.")
      }
      if (classified.kind === "bolt11_invoice") {
        const reused = await findInFlightOrCompletedWithdrawalForDestination(
          request.merchant_id,
          classified.normalized,
          request.id
        )
        if (reused) {
          throw Object.assign(new Error("This Lightning invoice has already been used for a withdrawal."), { status: 409 })
        }
      }
      const amountSats = parseBtcToSats(request.amount_decimal)
      const response = await createConnectedAccountWithdrawal({
        merchantId: request.merchant_id,
        speedAccountId,
        amount: amountSats,
        currency: "SATS",
        withdrawMethod: classified.method === "onchain" ? "onchain" : "lightning",
        withdrawRequest: classified.normalized,
        idempotencyKey: request.id,
      })
      return {
        provider: "speed",
        providerReference: response.id,
        txHash: null,
      }
    },
  }
}

export function createDefaultWithdrawalSigner(): WithdrawalSigner {
  // Dynamic is the preferred execution path when the browser SDK is configured,
  // for Base/Solana and (only if explicitly re-enabled) the legacy on-chain
  // BTC PSBT flow. Bitcoin/Lightning withdrawals otherwise execute through the
  // merchant's connected Speed account - no browser signature needed.
  const dynamicSigner = dynamicEnvironmentConfigured()
    ? dynamicBrowserWithdrawalSigner()
    : disabledWithdrawalSigner()
  const speedSigner = speedConnectedAccountWithdrawalSigner()

  function executesViaSpeed(rail: WalletWithdrawalRail) {
    return rail === "bitcoin" && !isDynamicBtcLegacyEnabled()
  }

  return {
    async canSignWithdrawal(input) {
      return executesViaSpeed(input.rail) ? speedSigner.canSignWithdrawal(input) : dynamicSigner.canSignWithdrawal(input)
    },
    async createWithdrawalReview(input) {
      return executesViaSpeed(input.rail) ? speedSigner.createWithdrawalReview(input) : dynamicSigner.createWithdrawalReview(input)
    },
    async submitWithdrawal(input) {
      return executesViaSpeed(input.request.rail) ? speedSigner.submitWithdrawal(input) : dynamicSigner.submitWithdrawal(input)
    },
  }
}
