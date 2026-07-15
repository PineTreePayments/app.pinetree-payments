import type { PaymentStatus, StandardPaymentEvent } from "@/types/provider"

export type Shift4CreatePaymentInput = {
  paymentId: string
  merchantAmount: number
  pinetreeFee: number
  grossAmount: number
  currency: string
  merchantWallet: string
  pinetreeWallet: string
  merchantId?: string
  network?: string
  providerApiKey?: string
}

export type Shift4NormalizedPayment = {
  provider: "shift4"
  providerReference: string
  status: PaymentStatus
  amount: number
  currency: string
  paymentUrl?: string
  hostedUrl?: string
  sessionUrl?: string
  clientSecret?: string
  qrCodeUrl?: string
  feeCaptureMethod: "invoice_split"
  raw: unknown
}

export type Shift4PaymentStatus = {
  provider: "shift4"
  providerReference: string
  status: PaymentStatus
  raw: unknown
}

export type Shift4TranslatedEvent = StandardPaymentEvent & {
  provider: "shift4"
  providerReference?: string
  providerEvent?: string
  raw: unknown
}
