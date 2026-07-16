/**
 * Normalized PineTree-facing Stripe Terminal types. Raw Stripe objects never
 * cross the provider boundary — only these shapes do.
 */

export type StripeTerminalAddress = {
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
}

export type StripeTerminalLocation = {
  id: string
  displayName: string
  address: StripeTerminalAddress
  livemode: boolean
}

export type StripeReaderStatus = "online" | "offline" | "unknown"

export type StripeTerminalReader = {
  id: string
  label: string
  deviceType: string
  serialNumber: string | null
  status: StripeReaderStatus
  locationId: string | null
  simulated: boolean
  livemode: boolean
}

export type StripeReaderActionStatus = "in_progress" | "succeeded" | "failed" | "none"

export type StripeReaderActionState = {
  type: string | null
  status: StripeReaderActionStatus
  paymentIntentId: string | null
  failureCode: string | null
  failureMessage: string | null
}

/**
 * Safe, normalized reader operation errors. Raw Stripe error internals stay
 * server-side; PineTree Engine maps these to merchant-facing messages.
 */
export type StripeReaderErrorKind =
  | "reader_busy"
  | "reader_offline"
  | "reader_timeout"
  | "intent_invalid"
  | "provider_error"

export class StripeReaderOperationError extends Error {
  kind: StripeReaderErrorKind

  constructor(kind: StripeReaderErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = "StripeReaderOperationError"
  }
}
