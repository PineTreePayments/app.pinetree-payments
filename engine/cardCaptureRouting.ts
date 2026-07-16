export type StripeCardRoutingPreference = "automatic" | "terminal_first" | "tap_to_pay_first"
export type RecommendedCardMethod = "terminal_reader" | "tap_to_pay" | "manual_entry" | "payment_link" | null

export function resolveRecommendedCardMethod(input: {
  routingPreference: StripeCardRoutingPreference
  hasUsableReader: boolean
  tapToPayAvailable: boolean
  manualEntryEnabled: boolean
  paymentLinkAvailable: boolean
}): RecommendedCardMethod {
  const terminal = input.hasUsableReader ? ("terminal_reader" as const) : null
  const tapToPay = input.tapToPayAvailable ? ("tap_to_pay" as const) : null
  const manual = input.manualEntryEnabled ? ("manual_entry" as const) : null
  const link = input.paymentLinkAvailable ? ("payment_link" as const) : null
  const order = input.routingPreference === "tap_to_pay_first"
    ? [tapToPay, terminal, manual, link]
    : [terminal, tapToPay, manual, link]
  return order.find((method) => method !== null) ?? null
}
