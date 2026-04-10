export type PaymentProvider =
  | "coinbase"
  | "shift4"
  | "solana"

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "FAILED"
  | "INCOMPLETE"
  | "EXPIRED"
  | "REFUNDED"