export type Shift4CertificationChannel = "ecommerce" | "retail"

export const SHIFT4_CERTIFICATION_CASE_IDS = Object.freeze([
  ...Array.from({ length: 23 }, (_, index) => `ecommerce-${index < 14 ? "evaluated" : "attest"}-${index + 1}`),
  ...Array.from({ length: 26 }, (_, index) => `retail-${index < 18 ? "evaluated" : "attest"}-${index + 1}`),
])

export function selectShift4CertificationCases(channel: Shift4CertificationChannel | "all", requested: string[] = []): string[] {
  const allowed = SHIFT4_CERTIFICATION_CASE_IDS.filter((id) => channel === "all" || id.startsWith(`${channel}-`))
  if (requested.length === 0) return allowed
  const requestedSet = new Set(requested)
  const selected = allowed.filter((id) => requestedSet.has(id))
  if (selected.length !== requestedSet.size) throw Object.assign(new Error("One or more certification case IDs are invalid for this channel"), { status: 400, code: "invalid_certification_case" })
  return selected
}
