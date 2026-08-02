import { createHash } from "node:crypto"
import type { Shift4StructuredEmailEnvelope } from "./types"
import { getShift4OnboardingConfig } from "./config"

export type SanitizedShift4EmailUpdate = Readonly<{
  messageIdentity: string; senderAllowed: boolean; providerApplicationId: string | null;
  statusHint: string | null; attachmentCount: number; requiresManualReview: boolean
}>

export function sanitizeStructuredEmailUpdate(
  input: Shift4StructuredEmailEnvelope,
  senderDomainAllowlist: readonly string[] = getShift4OnboardingConfig().senderDomainAllowlist
): SanitizedShift4EmailUpdate {
  const domain = input.senderDomain.trim().toLowerCase()
  const allowlist = senderDomainAllowlist.map((value) => value.trim().toLowerCase()).filter(Boolean)
  const combined = `${input.subject}\n${input.bodyText}`
  const application = combined.match(/\b(?:application|app)[- #:]*([a-z0-9-]{6,80})\b/i)?.[1] || null
  const status = combined.match(/\b(under_review|approved|declined|more_information_required|submitted)\b/i)?.[1]?.toLowerCase() || null
  const senderAllowed = allowlist.includes(domain)
  return Object.freeze({ messageIdentity: createHash("sha256").update(input.messageId).digest("hex"), senderAllowed,
    providerApplicationId: application, statusHint: status, attachmentCount: input.attachmentMetadata?.length || 0,
    requiresManualReview: !senderAllowed || !application || !status || Boolean(input.attachmentMetadata?.length) })
}
