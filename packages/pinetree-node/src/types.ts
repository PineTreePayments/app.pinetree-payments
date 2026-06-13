export type CheckoutSessionStatus =
  | "open"
  | "processing"
  | "paid"
  | "failed"
  | "expired"
  | "canceled"

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
  supportedRails: string[]
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
  rails?: string[]
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

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed"

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

export type Event<T = unknown> = {
  eventId: string
  type: string
  createdAt: string
  data: {
    object: T
  }
}

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
