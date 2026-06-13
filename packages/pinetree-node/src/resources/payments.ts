import type { PineTreeClient } from "../client"
import type { Payment } from "../types"

export class PaymentsResource {
  constructor(private readonly client: PineTreeClient) {}

  retrieve(id: string) {
    return this.client.request<Payment>({
      method: "GET",
      path: `/api/v1/payments/${encodeURIComponent(id)}`,
    })
  }
}
