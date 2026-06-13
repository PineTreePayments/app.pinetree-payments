import type { PineTreeClient } from "../client"
import type {
  WebhookDelivery,
  WebhookDeliveryList,
  WebhookDeliveryListParams,
} from "../types"

export class WebhookDeliveriesResource {
  constructor(private readonly client: PineTreeClient) {}

  list(params: WebhookDeliveryListParams = {}) {
    return this.client.request<WebhookDeliveryList>({
      method: "GET",
      path: "/api/v1/webhook-deliveries",
      query: {
        limit: params.limit,
        cursor: params.cursor,
        status: params.status,
        eventType: params.eventType,
      },
    })
  }

  retry(id: string) {
    return this.client.request<WebhookDelivery>({
      method: "POST",
      path: `/api/v1/webhook-deliveries/${encodeURIComponent(id)}/retry`,
    })
  }
}
