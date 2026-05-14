import { createSupportTicketRecord, type SupportTicketRecord } from "@/database/supportTickets"
import {
  supportTicketCategories,
  supportTicketPriorities
} from "@/lib/help/supportOptions"

type SupportValidationError = Error & { status?: number }

function createValidationError(message: string): SupportValidationError {
  const error: SupportValidationError = new Error(message)
  error.status = 400
  return error
}

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
    throw createValidationError(`${field} is required`)
  }
  return cleaned
}

function cleanOptionalUuid(value: string | null | undefined, field: string) {
  const cleaned = String(value || "").trim()
  if (!cleaned) return null

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(cleaned)) {
    throw createValidationError(`${field} must be a valid payment ID`)
  }

  return cleaned
}

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicketRecord> {
  const merchantId = cleanRequired(input.merchantId, "merchantId")
  const category = normalizeChoice(input.category, supportTicketCategories, "General Support")
  const priority = normalizeChoice(input.priority, supportTicketPriorities, "Normal")
  const subject = cleanRequired(input.subject, "subject").slice(0, 160)
  const description = cleanRequired(input.description, "description").slice(0, 5000)
  const relatedPaymentId = cleanOptionalUuid(input.relatedPaymentId, "relatedPaymentId")

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
