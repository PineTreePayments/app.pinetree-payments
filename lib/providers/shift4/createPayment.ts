import type { PaymentStatus } from "@/types/provider"
import { Shift4Client } from "./client"
import { SHIFT4_CHECKOUT_SESSIONS_PATH } from "./constants"
import type { Shift4CreatePaymentInput, Shift4NormalizedPayment } from "./types"

type CreatePaymentOptions = {
  client?: Shift4Client
}

export async function createPayment(
  input: Shift4CreatePaymentInput,
  options: CreatePaymentOptions = {}
): Promise<Shift4NormalizedPayment> {
  const client = options.client || new Shift4Client({ secretKey: input.providerApiKey })
  const request = buildShift4CreatePaymentRequest(input)
  const raw = await client.post<Record<string, unknown>>(SHIFT4_CHECKOUT_SESSIONS_PATH, request)
  const providerReference = readString(raw, ["id"])

  if (!providerReference) {
    throw new Error("Shift4 checkout session response missing id")
  }

  const sessionUrl = readString(raw, ["url"]) || undefined

  return {
    provider: "shift4",
    providerReference,
    status: "CREATED",
    amount: input.grossAmount,
    currency: input.currency,
    paymentUrl: sessionUrl,
    hostedUrl: sessionUrl,
    sessionUrl,
    clientSecret: readString(raw, ["clientSecret"]) || undefined,
    qrCodeUrl: readString(raw, ["qr_code_url"]) || undefined,
    feeCaptureMethod: "invoice_split",
    raw
  }
}

export function buildShift4CreatePaymentRequest(input: Shift4CreatePaymentInput) {
  const amount = Math.round(Number(input.grossAmount) * 100)
  const currency = String(input.currency || "").toUpperCase()

  return {
    lineItems: [
      {
        product: {
          name: `PineTree payment ${input.paymentId}`,
          amount,
          currency
        },
        quantity: 1
      }
    ],
    collectBillingAddress: true,
    collectShippingAddress: false,
    action: "payment",
    capture: true,
    metadata: {
      paymentId: input.paymentId,
      merchantId: input.merchantId,
      provider: "pinetree"
    },
    vendorReference: input.paymentId
  }
}

export function normalizeShift4PaymentStatus(status: unknown): PaymentStatus {
  const normalized = String(status || "").toLowerCase().trim()

  if (normalized === "created" || normalized === "new") return "CREATED"
  if (normalized === "pending" || normalized === "open") return "PENDING"
  // Card authorization means the card was approved or funds were held. It is
  // not final settlement. PineTree should stay PROCESSING until the selected
  // Shift4 final-money-movement state is documented and observed.
  if (
    normalized === "authorized" ||
    normalized === "approved" ||
    normalized === "processing" ||
    normalized === "settling"
  ) {
    return "PROCESSING"
  }
  // Captured/settled-style states are the only card states this placeholder
  // treats as final enough for PineTree CONFIRMED. Do not promote auth-only
  // states to CONFIRMED.
  if (
    normalized === "captured" ||
    normalized === "settled" ||
    normalized === "completed" ||
    normalized === "paid" ||
    normalized === "successful"
  ) {
    return "CONFIRMED"
  }
  if (normalized === "failed" || normalized === "declined" || normalized === "voided") {
    return "FAILED"
  }
  if (normalized === "expired") return "EXPIRED"
  if (normalized === "canceled" || normalized === "cancelled") return "INCOMPLETE"
  if (normalized === "refunded") return "REFUNDED"

  // Unknown provider statuses must never confirm a payment.
  return "PENDING"
}

function readString(value: unknown, path: string[]): string {
  let cursor: unknown = value
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return ""
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return String(cursor || "").trim()
}
