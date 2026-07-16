import { Shift4Client } from "./client"
import { SHIFT4_CHARGES_PATH } from "./constants"
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

  if (!reference.startsWith("char_")) {
    return {
      provider: "shift4",
      providerReference: reference,
      status: "UNKNOWN",
      raw: {
        providerReference: reference,
        reason: "Shift4 public docs document charge retrieval, but not checkout session status retrieval."
      }
    }
  }

  const raw = await client.get<Record<string, unknown>>(`${SHIFT4_CHARGES_PATH}/${encodeURIComponent(reference)}`)

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
