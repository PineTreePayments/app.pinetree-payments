import { Shift4Client } from "./client"
import { SHIFT4_CHARGES_PATH, SHIFT4_CHECKOUT_SESSIONS_PATH } from "./constants"
import { normalizeShift4PaymentStatus } from "./payments"
import type { Shift4PaymentStatus } from "./types"

type GetPaymentStatusOptions = {
  client?: Shift4Client
}

export async function getPaymentStatus(
  providerReference: string,
  options: GetPaymentStatusOptions = {}
): Promise<Shift4PaymentStatus> {
  const reference = String(providerReference || "").trim()
  if (!reference) throw new Error("Shift4 provider reference is required")

  const client = options.client || new Shift4Client()

  const path = reference.startsWith("chse_")
    ? `${SHIFT4_CHECKOUT_SESSIONS_PATH}/${encodeURIComponent(reference)}`
    : reference.startsWith("char_")
      ? `${SHIFT4_CHARGES_PATH}/${encodeURIComponent(reference)}`
      : ""

  if (!path) throw new Error(`Unsupported Shift4 provider reference: ${reference}`)

  const raw = await client.get<Record<string, unknown>>(path)

  return {
    provider: "shift4",
    providerReference: readString(raw, ["id"]) || reference,
    status: normalizeShift4PaymentStatus(readString(raw, ["status"])),
    raw
  }
}

function readString(value: unknown, path: string[]): string {
  let cursor: unknown = value
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return ""
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return String(cursor || "").trim()
}
