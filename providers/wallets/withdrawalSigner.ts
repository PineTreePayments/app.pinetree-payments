import type {
  WalletWithdrawalAsset,
  WalletWithdrawalRail,
  WalletWithdrawalRequestRecord,
} from "@/database/walletWithdrawalRequests"

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
  estimatedStatus: "Withdrawal review available" | "Signing not enabled yet"
  message: string
}

export interface WithdrawalSigner {
  canSignWithdrawal(input: WithdrawalSignerInput): Promise<boolean>
  createWithdrawalReview(input: WithdrawalSignerInput): Promise<WithdrawalReview>
  submitWithdrawal(input: {
    request: WalletWithdrawalRequestRecord
  }): Promise<{ providerReference: string }>
}

function signingEnabled() {
  return process.env.PINETREE_WALLET_WITHDRAWAL_SIGNING_ENABLED === "true"
}

export function createDefaultWithdrawalSigner(): WithdrawalSigner {
  return {
    async canSignWithdrawal() {
      return signingEnabled()
    },
    async createWithdrawalReview(input) {
      const signerEnabled = signingEnabled()
      return {
        rail: input.rail,
        asset: input.asset,
        destinationAddress: input.destinationAddress,
        amountDecimal: input.amountDecimal,
        signerEnabled,
        estimatedStatus: signerEnabled ? "Withdrawal review available" : "Signing not enabled yet",
        message: signerEnabled
          ? "Withdrawal review available"
          : "Withdrawal review available. Signing not enabled yet.",
      }
    },
    async submitWithdrawal() {
      if (!signingEnabled()) {
        throw new Error("Withdrawal signing not enabled")
      }
      throw new Error("Withdrawal signer provider is not configured")
    },
  }
}
