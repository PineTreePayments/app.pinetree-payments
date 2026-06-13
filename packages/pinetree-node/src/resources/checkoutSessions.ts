import type { PineTreeClient } from "../client"
import type {
  CheckoutSession,
  CheckoutSessionCreateOptions,
  CheckoutSessionCreateParams,
  CheckoutSessionList,
  CheckoutSessionListParams,
} from "../types"

export class CheckoutSessionsResource {
  constructor(private readonly client: PineTreeClient) {}

  create(
    params: CheckoutSessionCreateParams,
    options: CheckoutSessionCreateOptions = {}
  ) {
    return this.client.request<CheckoutSession>({
      method: "POST",
      path: "/api/v1/checkout/sessions",
      body: params,
      headers: options.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : undefined,
    })
  }

  retrieve(id: string) {
    return this.client.request<CheckoutSession>({
      method: "GET",
      path: `/api/v1/checkout/sessions/${encodeURIComponent(id)}`,
    })
  }

  list(params: CheckoutSessionListParams = {}) {
    return this.client.request<CheckoutSessionList>({
      method: "GET",
      path: "/api/v1/checkout/sessions",
      query: {
        limit: params.limit,
        starting_after: params.startingAfter,
        cursor: params.cursor,
        status: params.status,
        reference: params.reference,
        created_after: params.createdAfter,
        created_before: params.createdBefore,
      },
    })
  }

  cancel(id: string) {
    return this.client.request<CheckoutSession>({
      method: "POST",
      path: `/api/v1/checkout/sessions/${encodeURIComponent(id)}/cancel`,
    })
  }

  expire(id: string) {
    return this.client.request<CheckoutSession>({
      method: "POST",
      path: `/api/v1/checkout/sessions/${encodeURIComponent(id)}/expire`,
    })
  }
}
