import { SHIFT4_ONBOARDING_STATUSES, type Shift4OnboardingStatus, type Shift4OnboardingUpdate } from "./types"

const SAFE_REASON = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i

export function normalizeShift4OnboardingUpdate(value: unknown): Shift4OnboardingUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Onboarding update must be an object")
  const row = value as Record<string, unknown>
  const status = String(row.status || "") as Shift4OnboardingStatus
  if (!SHIFT4_ONBOARDING_STATUSES.includes(status)) throw new Error("Unsupported Shift4 onboarding status")
  const required = (key: string, max = 200) => {
    const result = String(row[key] || "").trim()
    if (!result || result.length > max) throw new Error(`${key} is invalid`)
    return result
  }
  const reasonCode = row.reasonCode == null ? null : String(row.reasonCode).trim()
  if (reasonCode && !SAFE_REASON.test(reasonCode)) throw new Error("reasonCode is invalid")
  const occurredAt = required("occurredAt", 40)
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("occurredAt is invalid")
  const source = row.source === "fixture" || row.source === "structured_email" || row.source === "provider_api" ? row.source : null
  if (!source) throw new Error("source is invalid")
  return Object.freeze({
    providerApplicationId: required("providerApplicationId"), updateReference: required("updateReference"),
    status, reasonCode: reasonCode || null, occurredAt: new Date(occurredAt).toISOString(),
    correlationId: required("correlationId"), verified: row.verified === true, source,
  })
}
