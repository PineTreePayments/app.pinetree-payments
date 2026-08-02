import type { Shift4CommerceEngineResult } from "./types"

/** Normalizes simulator/certification evidence only; no undocumented wire payload is interpreted. */
export function normalizeCommerceEngineFixture(value: unknown): Shift4CommerceEngineResult {
  if (!value || typeof value !== "object") throw new Error("Commerce Engine fixture must be an object")
  const row = value as Record<string, unknown>
  const outcome = row.outcome
  if (!["approved", "declined", "partial_approval", "referral", "unknown"].includes(String(outcome))) {
    throw new Error("Commerce Engine fixture has an invalid outcome")
  }
  const approvedAmountMinor = row.approvedAmountMinor == null ? null : Number(row.approvedAmountMinor)
  if (approvedAmountMinor !== null && (!Number.isSafeInteger(approvedAmountMinor) || approvedAmountMinor < 0)) {
    throw new Error("Commerce Engine fixture has an invalid approved amount")
  }
  return Object.freeze({
    outcome: outcome as Shift4CommerceEngineResult["outcome"],
    responseCode: typeof row.responseCode === "string" ? row.responseCode : null,
    authorizationCode: typeof row.authorizationCode === "string" ? row.authorizationCode : null,
    retrievalReference: typeof row.retrievalReference === "string" ? row.retrievalReference : null,
    approvedAmountMinor,
    signatureRequired: row.signatureRequired === true,
    lookupRequired: row.lookupRequired === true || outcome === "unknown",
  })
}
