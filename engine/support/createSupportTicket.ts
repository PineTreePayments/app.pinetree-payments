import { createSupportTicketRecord, type SupportTicketRecord } from "@/database/supportTickets"

export const SUPPORT_TICKET_CATEGORIES = [
  "Payment Issue",
  "Wallet Connection",
  "Dashboard Issue",
  "Settlement Question",
  "POS Issue",
  "Feature Request",
  "API Support",
  "General Support"
] as const

export const SUPPORT_TICKET_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const

export type SupportTicketCategory = typeof SUPPORT_TICKET_CATEGORIES[number]
export type SupportTicketPriority = typeof SUPPORT_TICKET_PRIORITIES[number]

export type CreateSupportTicketInput = {
  merchantId: string
  userId?: string | null
  category: string
  subject: string
  description: string
  priority?: string
  relatedPaymentId?: string | null
}

function normalizeChoice<T extends readonly string[]>(value: string | undefined, choices: T, fallback: T[number]) {
  const normalized = String(value || "").trim().toLowerCase()
  return choices.find((choice) => choice.toLowerCase() === normalized) ?? fallback
}

function cleanRequired(value: string, field: string) {
  const cleaned = String(value || "").trim()
  if (!cleaned) {
    throw new Error(`${field} is required`)
  }
  return cleaned
}

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicketRecord> {
  const merchantId = cleanRequired(input.merchantId, "merchantId")
  const category = normalizeChoice(input.category, SUPPORT_TICKET_CATEGORIES, "General Support")
  const priority = normalizeChoice(input.priority, SUPPORT_TICKET_PRIORITIES, "Normal")
  const subject = cleanRequired(input.subject, "subject").slice(0, 160)
  const description = cleanRequired(input.description, "description").slice(0, 5000)
  const relatedPaymentId = String(input.relatedPaymentId || "").trim() || null

  return createSupportTicketRecord({
    merchantId,
    userId: input.userId ?? null,
    category,
    subject,
    description,
    priority: priority.toLowerCase(),
    status: "open",
    relatedPaymentId
  })
}
