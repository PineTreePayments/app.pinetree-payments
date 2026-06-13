import { PineTreeClient } from "./client"
import { CheckoutSessionsResource } from "./resources/checkoutSessions"
import { PaymentsResource } from "./resources/payments"
import { WebhookDeliveriesResource } from "./resources/webhookDeliveries"
import { WebhooksResource } from "./resources/webhooks"
import type { PineTreeOptions } from "./types"

export class PineTree {
  readonly checkout: {
    sessions: CheckoutSessionsResource
  }
  readonly payments: PaymentsResource
  readonly webhookDeliveries: WebhookDeliveriesResource
  readonly webhooks: WebhooksResource

  constructor(apiKeyOrOptions: string | PineTreeOptions) {
    const client = new PineTreeClient(apiKeyOrOptions)
    this.checkout = {
      sessions: new CheckoutSessionsResource(client),
    }
    this.payments = new PaymentsResource(client)
    this.webhookDeliveries = new WebhookDeliveriesResource(client)
    this.webhooks = new WebhooksResource()
  }
}

export default PineTree

export * from "./errors"
export * from "./types"
export {
  PineTreeWebhookHeaders,
  PineTreeWebhookVersion,
} from "./resources/webhooks"
export type {
  PineTreeWebhookHeaderObject,
  PineTreeWebhookHeaderValue,
} from "./resources/webhooks"
