export type PaymentStatus =
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"
  | "REFUNDED"

const validTransitions: Record<PaymentStatus, PaymentStatus[]> = {

  PENDING: ["PROCESSING", "FAILED", "EXPIRED"],

  PROCESSING: ["CONFIRMED", "FAILED", "EXPIRED"],

  CONFIRMED: ["REFUNDED"],

  FAILED: [],

  EXPIRED: [],

  REFUNDED: []

}

export function canTransition(
  current: PaymentStatus,
  next: PaymentStatus
) {

  const allowed = validTransitions[current]

  return allowed.includes(next)

}

export function assertValidTransition(
  current: PaymentStatus,
  next: PaymentStatus
) {

  if (!canTransition(current, next)) {

    throw new Error(
      `Invalid payment transition: ${current} → ${next}`
    )

  }

}