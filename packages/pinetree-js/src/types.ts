// Browser SDK public types. Server API keys and webhook secrets are not exposed.

export type PineTreeJSOptions = {
  publicKey: string
  baseUrl?: string
}

export type CheckoutMode = "redirect" | "popup" | "embedded"

export type CheckoutSessionRail =
  | "solana"
  | "base"
  | "bitcoin_lightning"
  | "lightning"
  | "shift4"

export type CheckoutOptions = {
  amount: number
  currency?: string
  reference?: string
  customer?: {
    email?: string
  }
  metadata?: Record<string, unknown>
  rails?: CheckoutSessionRail[]
  successUrl?: string
  cancelUrl?: string
  mode?: CheckoutMode
  container?: string | HTMLElement
  /**
   * @deprecated Use `mode` instead. When `mode` is omitted, false suppresses
   * redirect navigation for backward compatibility.
   */
  redirect?: boolean
}

export type CheckoutSessionResult = {
  sessionId: string
  status: string
  checkoutUrl: string
  reference: string | null
  paymentId: string | null
}

export type CheckoutEventName =
  | "complete"
  | "failed"
  | "expired"
  | "canceled"
  | "closed"

export type CheckoutEventPayload = {
  source: "pinetree-checkout"
  version: 1
  event: CheckoutEventName
  sessionId: string
  status: string
}

export type CheckoutEvent = CheckoutEventPayload
export type CheckoutEventHandler = (event: CheckoutEventPayload) => void

export type CheckoutOpenResult = CheckoutSessionResult & {
  iframe?: HTMLIFrameElement
  popup?: Window
  on(event: CheckoutEventName, handler: CheckoutEventHandler): void
  off(event: CheckoutEventName, handler: CheckoutEventHandler): void
  destroy(): void
}

export type CheckoutError = {
  type: string
  code: string
  message: string
}

export const WEBHOOK_SCHEMA = "payments-v1"
export const WEBHOOK_SCHEMA_HEADER = "PineTree-Event-Schema"
export const LEGACY_SCHEMA_HEADER = "PineTree-Webhook-Version"

export type Payment = {
  id: string
  object: "payment"
  status: string
  amount: number
  currency: string
  network: string | null
  rail: string | null
  reference: string | null
  metadata: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export type CheckoutSession = {
  id: string
  object: "checkout.session"
  status: string
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

export type PaymentLink = {
  id: string
  object: "payment_link"
  status: "active" | "disabled" | "expired" | string
  amount: number | null
  currency: string | null
  reference: string | null
  metadata: Record<string, unknown>
}

export type PaymentEventType =
  | "payment.created"
  | "payment.pending"
  | "payment.processing"
  | "payment.confirmed"
  | "payment.failed"
  | "payment.expired"
  | "payment.canceled"
  | "payment.incomplete"
  | "payment.refunded"

export type CheckoutSessionEventType =
  | "checkout.session.created"
  | "checkout.session.processing"
  | "checkout.session.completed"
  | "checkout.session.failed"
  | "checkout.session.expired"
  | "checkout.session.canceled"

export type PaymentLinkEventType =
  | "payment_link.created"
  | "payment_link.disabled"
  | "payment_link.expired"

export type WebhookEventType = PaymentEventType | CheckoutSessionEventType | PaymentLinkEventType

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
