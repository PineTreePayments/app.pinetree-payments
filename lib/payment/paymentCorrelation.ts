export const PAYMENT_CORRELATION_HEADER = "x-pinetree-correlation-id"

export function normalizePaymentCorrelationId(value: unknown): string | undefined {
  const normalized = String(value || "").trim()
  if (!normalized || normalized.length > 128) return undefined
  return /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : undefined
}
