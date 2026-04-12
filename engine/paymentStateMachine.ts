/**
 * PineTree Payment State Machine
 * 
 * Defines valid payment status transitions and provides
 * validation for state changes.
 */

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "INCOMPLETE"

export function normalizeToStrictPaymentStatus(status: unknown): PaymentStatus {
  const normalized = String(status || "").toUpperCase().trim()

  if (normalized === "EXPIRED") return "INCOMPLETE"
  if (normalized === "REFUNDED") return "CONFIRMED"

  if (
    normalized === "CREATED" ||
    normalized === "PENDING" ||
    normalized === "PROCESSING" ||
    normalized === "CONFIRMED" ||
    normalized === "FAILED" ||
    normalized === "INCOMPLETE"
  ) {
    return normalized
  }

  throw new Error(`Unknown payment status: ${String(status || "")}`)
}

/**
 * Valid state transitions for payments
 * 
 * Each status can only transition to specific next statuses.
 * This ensures payments follow a valid lifecycle.
 */
const validTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  // Strict lifecycle: CREATED -> PENDING -> PROCESSING -> CONFIRMED
  CREATED: ["PENDING"],

  // Allowed alternative path: PENDING -> INCOMPLETE
  PENDING: ["PROCESSING", "INCOMPLETE"],

  // Allowed alternative path: PROCESSING -> FAILED
  PROCESSING: ["CONFIRMED", "FAILED"],

  // Terminal state
  CONFIRMED: [],

  // Terminal states - no further transitions
  FAILED: [],
  INCOMPLETE: []
}

/**
 * Check if a transition from current to next status is valid
 * 
 * @param current - Current payment status
 * @param next - Desired next status
 * @returns True if transition is allowed
 */
export function canTransition(
  current: PaymentStatus,
  next: PaymentStatus
): boolean {
  const allowed = validTransitions[current]
  return allowed.includes(next)
}

/**
 * Assert that a transition is valid, throwing an error if not
 * 
 * @param current - Current payment status
 * @param next - Desired next status
 * @throws Error if transition is not allowed
 */
export function assertValidTransition(
  current: PaymentStatus,
  next: PaymentStatus
): void {
  if (!canTransition(current, next)) {
    throw new Error(
      `Invalid payment transition: ${current} → ${next}`
    )
  }
}

/**
 * Get all valid next statuses for a given current status
 * 
 * @param current - Current payment status
 * @returns Array of valid next statuses
 */
export function getValidNextStatuses(current: PaymentStatus): PaymentStatus[] {
  return validTransitions[current] || []
}

/**
 * Check if a status is a terminal state (no further transitions possible)
 * 
 * @param status - Payment status to check
 * @returns True if status is terminal
 */
export function isTerminalStatus(status: PaymentStatus): boolean {
  return validTransitions[status].length === 0
}

/**
 * Get the initial status for a new payment
 */
export function getInitialStatus(): PaymentStatus {
  return "CREATED"
}