export type CheckoutSessionStatus =
  | "open"
  | "processing"
  | "paid"
  | "failed"
  | "expired"
  | "canceled"

export type CheckoutSessionRail =
  | "solana"
  | "base"
  | "bitcoin_lightning"
  | "lightning"
  | "shift4"

export type CheckoutSession = {
  id: string
  object: "checkout.session"
  status: CheckoutSessionStatus
  amount: number
  currency: string
  reference: string | null
  customer: { email: string | null }
  metadata: Record<string, unknown>
  checkoutUrl: string
  paymentId: string | null
  supportedRails: CheckoutSessionRail[]
  successUrl: string | null
  cancelUrl: string | null
  createdAt: string
  expiresAt: string | null
}

export type CheckoutSessionCreateParams = {
  amount: number
  currency?: string
  reference?: string
  customer?: { email?: string }
  metadata?: Record<string, unknown>
  rails?: CheckoutSessionRail[]
  successUrl?: string
  cancelUrl?: string
}

export type CheckoutSessionCreateOptions = {
  idempotencyKey?: string
}

export type CheckoutSessionListParams = {
  limit?: number
  startingAfter?: string
  cursor?: string
  status?: CheckoutSessionStatus
  reference?: string
  createdAfter?: string
  createdBefore?: string
}

export type CheckoutSessionList = {
  object: "list"
  data: CheckoutSession[]
  hasMore: boolean
  nextCursor: string | null
}

export type Payment = {
  id: string
  object: "payment"
  status: CheckoutSessionStatus
  amount: number
  currency: string
  network: string | null
  rail: string | null
  reference: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type PaymentLink = {
  id: string
  object: "payment_link"
  status: "active" | "disabled" | "expired" | string
  amount: number | null
  currency: string | null
  reference: string | null
  metadata: Record<string, unknown>
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "dead_letter"

export type WebhookDelivery = {
  id: string
  object: "webhook.delivery"
  eventType: string
  status: WebhookDeliveryStatus
  attemptCount: number
  nextAttemptAt: string | null
  lastAttemptAt: string | null
  lastStatusCode: number | null
  lastError: string | null
  deliveredAt: string | null
  deadLetteredAt: string | null
  createdAt: string
}

export type WebhookDeliveryListParams = {
  limit?: number
  cursor?: string
  status?: WebhookDeliveryStatus
  eventType?: string
}

export type WebhookDeliveryList = {
  object: "list"
  data: WebhookDelivery[]
  hasMore: boolean
  nextCursor: string | null
}

export const WEBHOOK_SCHEMA = "payments-v1"
export const WEBHOOK_SCHEMA_HEADER = "PineTree-Event-Schema"
export const LEGACY_SCHEMA_HEADER = "PineTree-Webhook-Version"

export type PaymentEventType =
  | "payment.created"
  | "payment.pending"
  | "payment.processing"
  | "payment.confirmed"
  | "payment.failed"
  | "payment.expired"
  | "payment.cancelled"
  | "payment.incomplete"
  | "payment.refunded"

export type CheckoutSessionEventType =
  | "checkout.session.created"
  | "checkout.session.processing"
  | "checkout.session.completed"
  | "checkout.session.failed"
  | "checkout.session.expired"
  | "checkout.session.canceled"

export type LegacyCheckoutSessionEventType = "checkout.session.paid"

export type PaymentLinkEventType =
  | "payment_link.created"
  | "payment_link.disabled"
  | "payment_link.expired"

export type WebhookEventType =
  | PaymentEventType
  | CheckoutSessionEventType
  | PaymentLinkEventType

export type PineTreeEventBase<TType extends WebhookEventType, TObject> = {
  eventId: string
  object: "event"
  type: TType
  schema: typeof WEBHOOK_SCHEMA
  createdAt: string
  livemode: boolean
  data: {
    object: TObject
  }
}

export type PaymentEvent = PineTreeEventBase<PaymentEventType, Payment>
export type CheckoutSessionEvent = PineTreeEventBase<CheckoutSessionEventType, CheckoutSession>
export type PaymentLinkEvent = PineTreeEventBase<PaymentLinkEventType, PaymentLink>
export type PineTreeEvent = PaymentEvent | CheckoutSessionEvent | PaymentLinkEvent

export type Event<T = PineTreeEvent["data"]["object"]> = PineTreeEventBase<WebhookEventType, T>

export type PineTreeOptions = {
  apiKey: string
  baseUrl?: string
  timeout?: number
}

export type APIErrorPayload = {
  error?: {
    type?: string
    code?: string
    message?: string
    requestId?: string
  }
}
