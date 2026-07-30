/**
 * Single display formatter for support-ticket enums.
 *
 * Stored canonical values (`support_tickets.status`, `.priority`, `.category`,
 * `support_ticket_messages.sender_type`) are never changed to alter a label —
 * every merchant- and admin-facing surface renders them through the helpers
 * here so "urgent", "wallet_connection", and "waiting_on_merchant" cannot drift
 * into a hand-capitalized copy in one component and a raw enum in another.
 */

// Words that stay lowercase inside a title unless they lead the label.
const LOWERCASE_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
])

// Compact system labels that are already uppercase in the canonical value and
// must not be softened to title case ("POS Issue" must never render "Pos Issue").
const ACRONYMS = new Map(
  ["POS", "API", "ID", "SDK", "URL", "KYB", "AI", "USD", "BTC", "ETH", "USDC", "QR", "UUID"].map(
    (word) => [word.toLowerCase(), word]
  )
)

/**
 * Formats any support enum value for display.
 *
 *   "urgent"               → "Urgent"
 *   "wallet_connection"    → "Wallet Connection"
 *   "WAITING_ON_MERCHANT"  → "Waiting on Merchant"
 *   "POS Issue"            → "POS Issue"
 */
export function formatSupportEnumLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim()
  if (!raw) return "—"

  const words = raw.replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean)
  if (words.length === 0) return "—"

  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      const acronym = ACRONYMS.get(lower)
      if (acronym) return acronym
      if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(" ")
}

export const SUPPORT_TICKET_STATUSES = [
  "open",
  "in_review",
  "waiting_on_merchant",
  "resolved",
  "archived",
] as const

export type SupportTicketStatus = typeof SUPPORT_TICKET_STATUSES[number]

/** Full status label. Use wherever a ticket's own status is shown. */
export function formatSupportStatus(status: string | null | undefined): string {
  return formatSupportEnumLabel(status)
}

/**
 * Compact status labels for space-constrained chrome (filter chips, metric
 * tiles) where the full "Waiting on Merchant" would wrap or overflow. Still
 * properly capitalized — never a raw enum, never all-caps.
 */
const SHORT_STATUS_LABELS: Record<string, string> = {
  waiting_on_merchant: "Waiting",
}

export function formatSupportStatusShort(status: string | null | undefined): string {
  const key = String(status ?? "").trim().toLowerCase()
  return SHORT_STATUS_LABELS[key] ?? formatSupportEnumLabel(status)
}

export function formatSupportPriority(priority: string | null | undefined): string {
  return formatSupportEnumLabel(priority)
}

export function formatSupportCategory(category: string | null | undefined): string {
  return formatSupportEnumLabel(category)
}

export function formatSupportSenderLabel(
  senderType: string | null | undefined,
  senderName?: string | null
): string {
  const name = String(senderName ?? "").trim()
  if (name) return name
  if (senderType === "pinetree") return "PineTree Support"
  if (senderType === "system") return "System"
  return "Merchant"
}

/** Case-insensitive enum comparison for filters over historically mixed-case rows. */
export function supportEnumEquals(
  value: string | null | undefined,
  expected: string | null | undefined
): boolean {
  return String(value ?? "").trim().toLowerCase() === String(expected ?? "").trim().toLowerCase()
}

// ─── Tones ────────────────────────────────────────────────────────────────────

export const SUPPORT_STATUS_PILL_CLASSES: Record<string, string> = {
  open: "border-blue-200 bg-blue-50 text-blue-700",
  in_review: "border-amber-200 bg-amber-50 text-amber-700",
  waiting_on_merchant: "border-orange-200 bg-orange-50 text-orange-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  archived: "border-gray-200 bg-gray-100 text-gray-500",
}

export const SUPPORT_PRIORITY_PILL_CLASSES: Record<string, string> = {
  low: "border-gray-200 bg-gray-100 text-gray-500",
  normal: "border-blue-200 bg-blue-50 text-blue-600",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  urgent: "border-red-200 bg-red-50 text-red-700",
}

export function supportStatusPillClass(status: string | null | undefined): string {
  const key = String(status ?? "").trim().toLowerCase()
  return SUPPORT_STATUS_PILL_CLASSES[key] ?? "border-gray-200 bg-gray-100 text-gray-600"
}

export function supportPriorityPillClass(priority: string | null | undefined): string {
  const key = String(priority ?? "").trim().toLowerCase()
  return SUPPORT_PRIORITY_PILL_CLASSES[key] ?? "border-gray-200 bg-gray-100 text-gray-600"
}
