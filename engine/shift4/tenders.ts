import { getShift4TenderGroup } from "@/database/shift4TenderGroups"
import { listShift4PaymentAttempts } from "@/database/shift4PaymentAttempts"

export type Shift4TenderProgress = Readonly<{
  paymentId: string
  currency: string
  requestedAmountMinor: number
  approvedAmountMinor: number
  remainingAmountMinor: number
  state: "open" | "settled" | "closed" | "reconciliation_required"
  additionalTenderAllowed: boolean
  tenders: ReadonlyArray<{
    attemptId: string
    sequence: number
    state: string
    requestedAmountMinor: number
    approvedAmountMinor: number
  }>
}>

export async function getShift4TenderProgress(merchantId: string, paymentId: string): Promise<Shift4TenderProgress | null> {
  const group = await getShift4TenderGroup(merchantId, paymentId)
  if (!group) return null
  const attempts = await listShift4PaymentAttempts(merchantId, paymentId)
  const roots = attempts.filter((attempt) =>
    attempt.attempt_role !== "refund" && attempt.root_attempt_id === attempt.attempt_id
  )
  const approved = roots.reduce((sum, attempt) => {
    const value = attempt.state === "approved" ? Number(attempt.approved_amount_minor ?? 0) : 0
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid persisted Shift4 approved amount")
    return sum + value
  }, 0)
  const requested = Number(group.requested_amount_minor)
  if (!Number.isSafeInteger(requested) || requested <= 0 || approved > requested) {
    throw new Error("Shift4 tender totals require operator reconciliation")
  }
  const remaining = requested - approved
  return Object.freeze({
    paymentId,
    currency: group.currency,
    requestedAmountMinor: requested,
    approvedAmountMinor: approved,
    remainingAmountMinor: remaining,
    state: group.state,
    additionalTenderAllowed: group.state === "open" && remaining > 0,
    tenders: Object.freeze(roots.map((attempt) => ({
      attemptId: attempt.attempt_id,
      sequence: attempt.tender_sequence,
      state: attempt.state,
      requestedAmountMinor: attempt.amount_minor,
      approvedAmountMinor: attempt.approved_amount_minor ?? 0,
    }))),
  })
}

export function assertAdditionalTenderAmount(progress: Shift4TenderProgress, amountMinor: number): void {
  if (!progress.additionalTenderAllowed) throw Object.assign(new Error("This payment cannot accept another tender"), { status: 409, code: "tender_closed" })
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > progress.remainingAmountMinor) {
    throw Object.assign(new Error("Additional tender must be positive and no greater than the exact remaining amount"), { status: 400, code: "invalid_tender_amount" })
  }
}
