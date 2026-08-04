const SAFE_KEYS = new Set([
  "event", "merchantId", "paymentId", "attemptId", "invoice", "operation", "channel",
  "state", "outcome", "responseCode", "correlationId", "terminalReaderId", "durationMs",
  "lookupRequired", "reconciliationRequired", "approvedAmountMinor", "remainingAmountMinor",
  "providerConnectionId", "applicationId", "sessionId", "tenderGroupId", "readinessState",
  "certificationCaseId", "safeStatusReason", "onboardingStatus", "certificationComplete",
  "journalPostingExists", "additionalTenderRequired", "tokenizationStatus",
  // Connection-verification evidence. All four are non-secret: the connection
  // row id, the configured Shift4 environment name, Shift4's documented
  // `server.name`, and a PineTree timestamp.
  "connectionId", "environment", "serverName", "verifiedAt",
  // Terminal readiness evidence: which source a connectivity claim came from.
  // A fixed enum ("none" / "pinetree_local_configuration" /
  // "shift4_status_operation"), never a device identifier or serial.
  "evidenceSource",
])

const FORBIDDEN_KEY = /(token|secret|authorization|credential|password|guid|service.?role|pan|cardnumber|cvv|csc|track|pin|payload|body|header|tax|ssn|bank|routing|attachment|voice.?center)/i
const DANGEROUS_VALUE = /(?:bearer|basic)\s+[a-z0-9._~+\/-]+|(?:secret|token|password|cvv|csc|track|client\s*guid)\s*[:=]|(?:SECRET|CARD_TOKEN|PERSONAL_DATA)_SENTINEL_\d+|\b(?:\d[ -]?){12,19}\b/i

export function safeShift4LogFields(fields: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_KEYS.has(key) || FORBIDDEN_KEY.test(key)) continue
    if (value === null || typeof value === "number" || typeof value === "boolean") safe[key] = value
    else if (typeof value === "string" && !DANGEROUS_VALUE.test(value)) safe[key] = value.slice(0, 240)
  }
  return safe
}

export function logShift4Event(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const entry = safeShift4LogFields({ ...fields, event })
  if (level === "error") console.error("[shift4]", entry)
  else if (level === "warn") console.warn("[shift4]", entry)
  else console.info("[shift4]", entry)
}
