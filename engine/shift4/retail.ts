import { randomUUID } from "node:crypto"
import type { Shift4CommerceEngineClient, Shift4CommerceEngineRequest, Shift4CommerceEngineResult } from "@/providers/shift4/commerce-engine"

export const SHIFT4_RETAIL_RESPONSE_TIMEOUT_MS = 60_000
export type Shift4RetailState = "idle" | "device_claimed" | "presenting" | "approved" | "declined" | "action_required" | "unresolved" | "released"

export async function executeShift4RetailInteraction(input: {
  client: Shift4CommerceEngineClient
  request: Omit<Shift4CommerceEngineRequest, "correlationId">
  timeoutMs?: number
}): Promise<{ state: Shift4RetailState; result: Shift4CommerceEngineResult; correlationId: string }> {
  const correlationId = randomUUID()
  const timeoutMs = Math.max(1, Math.min(input.timeoutMs ?? SHIFT4_RETAIL_RESPONSE_TIMEOUT_MS, SHIFT4_RETAIL_RESPONSE_TIMEOUT_MS))
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutResult = new Promise<Shift4CommerceEngineResult>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(Object.freeze({ outcome: "unknown", responseCode: null, authorizationCode: null, retrievalReference: null, approvedAmountMinor: null, signatureRequired: false, lookupRequired: true })), timeoutMs)
  })
  const result = await Promise.race([input.client.execute({ ...input.request, correlationId }), timeoutResult])
  if (timeoutHandle) clearTimeout(timeoutHandle)
  const state: Shift4RetailState = result.outcome === "approved"
    ? "approved"
    : result.outcome === "declined"
      ? "declined"
      : result.outcome === "unknown"
        ? "unresolved"
        : "action_required"
  return { state, result, correlationId }
}
