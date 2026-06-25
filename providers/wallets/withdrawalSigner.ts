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
  estimatedStatus: "Withdrawal review available" | "Pending review" | "Processing"
  message: string
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
        estimatedStatus: "Pending review",
        message: "Withdrawal request can be reviewed before processing.",
      }
    },
    async submitWithdrawal() {
      throw new Error("Withdrawal signer is disabled")
    },
  }
}

export function createDefaultWithdrawalSigner(): WithdrawalSigner {
  // Dynamic is configured only through the browser SDK in this repo, and the
  // Fireblocks code currently provisions BTC addresses only. Keep execution
  // disabled until a real backend signing provider is implemented and tested.
  return disabledWithdrawalSigner()
}
