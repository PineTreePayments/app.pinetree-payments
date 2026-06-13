import type { PublicCheckoutSession } from "@/engine/publicCheckoutSessions"
import type { PublicCheckoutSessionStatus } from "@/engine/publicCheckoutSessionStatus"
import type { PublicPayment } from "@/engine/publicPayments"
import type { PublicWebhookDelivery } from "@/engine/publicWebhookDeliveries"

export type PineTreeList<T> = {
  object: "list"
  data: T[]
  hasMore: boolean
  nextCursor: string | null
}

export type CheckoutSessionCreateParams = {
  amount: number
  currency?: string
  reference?: string
  customer?: { email?: string }
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
  rails?: string[]
  idempotencyKey?: string
}

export type CheckoutSessionListParams = {
  limit?: number
  cursor?: string
  status?: PublicCheckoutSessionStatus
  reference?: string
  createdAfter?: string
  createdBefore?: string
}

export type WebhookDeliveryListParams = {
  limit?: number
  cursor?: string
  status?: "pending" | "delivered" | "failed"
  eventType?: string
}

export type PineTreeWebhookEvent<T = unknown> = {
  eventId: string
  type: string
  createdAt: string
  data: { object: T }
}

export interface PineTreeNodeSdkContract {
  checkout: {
    sessions: {
      create(params: CheckoutSessionCreateParams): Promise<PublicCheckoutSession>
      retrieve(id: string): Promise<PublicCheckoutSession>
      list(params?: CheckoutSessionListParams): Promise<PineTreeList<PublicCheckoutSession>>
      cancel(id: string): Promise<PublicCheckoutSession>
      expire(id: string): Promise<PublicCheckoutSession>
    }
  }
  payments: {
    retrieve(id: string): Promise<PublicPayment>
  }
  webhooks: {
    constructEvent(
      rawBody: string | Uint8Array,
      signature: string,
      secret: string,
      timestamp?: string
    ): PineTreeWebhookEvent
  }
  webhookDeliveries: {
    list(params?: WebhookDeliveryListParams): Promise<PineTreeList<PublicWebhookDelivery>>
    retry(id: string): Promise<PublicWebhookDelivery>
  }
}
