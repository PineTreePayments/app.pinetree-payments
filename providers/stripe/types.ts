import type { FeeCaptureMethod, PaymentStatus } from "@/types/provider"

export type StripePaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "succeeded"
  | "canceled"
  | string

export type StripePaymentIntent = {
  id: string
  object?: "payment_intent" | string
  amount?: number
  currency?: string
  client_secret?: string | null
  status?: StripePaymentIntentStatus
  metadata?: Record<string, string>
  [key: string]: unknown
}

export type StripeEvent = {
  id?: string
  object?: "event" | string
  type?: string
  data?: {
    object?: StripePaymentIntent & Record<string, unknown>
  }
  [key: string]: unknown
}

export type StripeCreatePaymentInput = {
  paymentId: string
  merchantAmount: number
  pinetreeFee: number
  grossAmount: number
  currency: string
  merchantWallet?: string
  pinetreeWallet?: string
  merchantId?: string
  providerApiKey?: string
  stripeConnectedAccountId?: string
}

export type StripePaymentIntentRequest = {
  amount: number
  currency: string
  automatic_payment_methods: {
    enabled: true
  }
  metadata: Record<string, string>
  // TODO: Add application_fee_amount only after Stripe fee settlement and
  // reconciliation are explicitly supported by PineTree's fee model.
}

export type StripeNormalizedPayment = {
  provider: "stripe"
  providerReference: string
  clientSecret?: string
  amount: number
  currency: string
  status: PaymentStatus
  feeCaptureMethod: FeeCaptureMethod
  raw: StripePaymentIntent
}

export type StripeTranslatedEvent = {
  provider: "stripe"
  providerReference: string
  providerEvent: string
  paymentId: string
  event: "payment.created" | "payment.processing" | "payment.confirmed" | "payment.failed" | "payment.canceled"
}
