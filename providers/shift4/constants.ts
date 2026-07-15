export const SHIFT4_PROVIDER_ID = "shift4" as const
export const SHIFT4_DISPLAY_NAME = "Shift4"
export const DEFAULT_SHIFT4_API_BASE_URL = "https://api.shift4.com"
export const SHIFT4_CHECKOUT_SESSIONS_PATH = "/checkout-sessions"
export const SHIFT4_CHARGES_PATH = "/charges"

export function getShift4ApiBaseUrl(): string {
  return String(process.env.SHIFT4_API_BASE_URL || DEFAULT_SHIFT4_API_BASE_URL)
    .trim()
    .replace(/\/+$/, "")
}

export function getShift4SecretKey(explicitKey?: string): string {
  return String(explicitKey || process.env.SHIFT4_SECRET_KEY || "").trim()
}

export function getShift4WebhookSecret(): string {
  return String(process.env.SHIFT4_WEBHOOK_SECRET || "").trim()
}
