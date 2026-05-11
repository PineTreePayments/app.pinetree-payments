import type { StandardPaymentEvent } from "@/types/provider"

function readPath(input: unknown, path: string[]): unknown {
  let cursor: unknown = input
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function normalizeStatus(value: unknown): string {
  return String(value || "").toLowerCase().trim()
}

export function translateLightningEvent(payload: unknown): StandardPaymentEvent {
  const paymentId = String(
    readPath(payload, ["metadata", "pineTreePaymentId"]) ||
    readPath(payload, ["metadata", "paymentId"]) ||
    readPath(payload, ["data", "object", "metadata", "pineTreePaymentId"]) ||
    readPath(payload, ["data", "object", "metadata", "paymentId"]) ||
    readPath(payload, ["data", "metadata", "pineTreePaymentId"]) ||
    readPath(payload, ["data", "metadata", "paymentId"]) ||
    readPath(payload, ["paymentId"]) ||
    readPath(payload, ["payment_id"]) ||
    ""
  ).trim()

  const status = normalizeStatus(
    readPath(payload, ["event_type"]) ||
    readPath(payload, ["type"]) ||
    readPath(payload, ["status"]) ||
    readPath(payload, ["data", "object", "status"]) ||
    readPath(payload, ["data", "status"]) ||
    readPath(payload, ["event"]) ||
    ""
  )

  if (
    status.includes("paid") ||
    status.includes("settled") ||
    status.includes("confirmed") ||
    status.includes("complete")
  ) {
    return { paymentId, event: "payment.confirmed" }
  }

  if (
    status.includes("pending") ||
    status.includes("created") ||
    status.includes("unpaid")
  ) {
    return { paymentId, event: "payment.pending" }
  }

  if (
    status.includes("processing") ||
    status.includes("settling")
  ) {
    return { paymentId, event: "payment.processing" }
  }

  if (
    status.includes("failed") ||
    status.includes("expired") ||
    status.includes("cancel")
  ) {
    return { paymentId, event: "payment.failed" }
  }

  return { paymentId, event: "payment.pending" }
}
