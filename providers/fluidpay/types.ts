import type { PaymentStatus } from "@/types/provider"

export type FluidPayCreatePaymentInput = {
  paymentId: string
  merchantAmount: number
  pinetreeFee: number
  grossAmount: number
  currency: string
  merchantWallet?: string
  pinetreeWallet?: string
  merchantId?: string
  providerApiKey?: string
}

export type FluidPayPaymentStatus = {
  provider: "fluidpay"
  providerReference: string
  status: PaymentStatus
}
