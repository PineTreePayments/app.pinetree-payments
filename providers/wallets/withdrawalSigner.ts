import type {
  WalletWithdrawalAsset,
  WalletWithdrawalRail,
  WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"
import { isBitcoinWithdrawalExecutionConfigured } from "@/providers/wallets/bitcoinNetworkProvider"

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
        (input.rail === "bitcoin" && input.asset === "BTC" && isBitcoinWithdrawalExecutionConfigured())
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

export function createDefaultWithdrawalSigner(): WithdrawalSigner {
  // Dynamic is the preferred execution path when the browser SDK is configured.
  // This signer only advertises browser approval; backend broadcasting stays
  // disabled unless a real server-side signer is added.
  return dynamicEnvironmentConfigured()
    ? dynamicBrowserWithdrawalSigner()
    : disabledWithdrawalSigner()
}
