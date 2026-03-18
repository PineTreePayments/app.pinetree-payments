export type PaymentProvider =
  | "coinbase"
  | "shift4"
  | "solana"

export type PaymentStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "expired"
  | "refunded"