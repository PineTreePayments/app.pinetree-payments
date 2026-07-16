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

// ─── Stripe Connect (connected accounts / embedded onboarding) ───────────────

/** Raw-but-bounded requirements snapshot from a Stripe Account. */
export type StripeAccountRequirements = {
  currentlyDue: string[]
  eventuallyDue: string[]
  pastDue: string[]
  pendingVerification: string[]
  disabledReason: string | null
}

/** Stripe capability state, e.g. { card_payments: "active", transfers: "pending" }. */
export type StripeAccountCapabilities = Record<string, string>

/** Basic connected-account snapshot (legacy hosted-link flow shape). */
export type StripeConnectedAccount = {
  id: string
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
}

/** Full normalized connected-account snapshot used for status synchronization. */
export type StripeConnectedAccountDetails = StripeConnectedAccount & {
  requirements: StripeAccountRequirements
  capabilities: StripeAccountCapabilities
  metadata: Record<string, string>
}

/**
 * PineTree-normalized Stripe connection status.
 *
 * Mapping from Stripe account properties (applied in this order — see
 * providers/stripe/capabilities.ts):
 *  - no connected account                                → not_connected
 *  - requirements.disabled_reason is terminal
 *    (rejected.*, listed, platform_paused, other)        → disabled
 *  - details_submitted = false                           → onboarding_required
 *  - requirements.past_due non-empty or
 *    disabled_reason = requirements.past_due             → restricted
 *  - charges_enabled && payouts_enabled                  → active
 *  - requirements.currently_due non-empty                → onboarding_required
 *  - otherwise (submitted, Stripe reviewing)             → pending_verification
 */
export type StripeConnectionStatus =
  | "not_connected"
  | "onboarding_required"
  | "pending_verification"
  | "restricted"
  | "active"
  | "disabled"

/** Safe, PineTree-facing normalized connection state. Never contains secrets. */
export type StripeNormalizedConnection = {
  provider: "stripe"
  connectionStatus: StripeConnectionStatus
  accountConnected: boolean
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  requirementsCurrentlyDue: string[]
  requirementsEventuallyDue: string[]
  requirementsPastDue: string[]
  requirementsPendingVerification: string[]
  disabledReason: string | null
  capabilities: StripeAccountCapabilities
}

export type StripeTranslatedEvent = {
  provider: "stripe"
  providerReference: string
  providerEvent: string
  paymentId: string
  event: "payment.created" | "payment.processing" | "payment.confirmed" | "payment.failed" | "payment.canceled"
}
