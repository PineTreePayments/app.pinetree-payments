import { StripeClient } from "../client"
import type { StripeTerminalAddress, StripeTerminalLocation } from "./types"

/**
 * Stripe Terminal Locations. Under the direct-charge model, locations live
 * on the merchant's connected account (see ../chargeModel.ts) — the
 * connectedAccountId is resolved server-side by PineTree Engine and is
 * never taken from a client.
 */

export function normalizeTerminalLocation(raw: Record<string, unknown>): StripeTerminalLocation {
  const address = (raw.address || {}) as Record<string, unknown>
  return {
    id: String(raw.id || ""),
    displayName: String(raw.display_name || ""),
    address: {
      line1: String(address.line1 || ""),
      line2: String(address.line2 || "") || undefined,
      city: String(address.city || ""),
      state: String(address.state || ""),
      postalCode: String(address.postal_code || ""),
      country: String(address.country || "")
    },
    livemode: raw.livemode === true
  }
}

/** Validates required Stripe address fields (per LocationCreateParams). */
export function assertValidTerminalAddress(address: StripeTerminalAddress): void {
  const required: Array<[keyof StripeTerminalAddress, string]> = [
    ["line1", "Address line 1"],
    ["city", "City"],
    ["state", "State"],
    ["postalCode", "Postal code"],
    ["country", "Country"]
  ]
  for (const [field, label] of required) {
    if (!String(address[field] || "").trim()) {
      throw new Error(`${label} is required for a Terminal location`)
    }
  }
  if (!/^[A-Za-z]{2}$/.test(address.country.trim())) {
    throw new Error("Country must be a two-letter code")
  }
}

export async function createStripeTerminalLocation(params: {
  connectedAccountId: string
  displayName: string
  address: StripeTerminalAddress
}): Promise<StripeTerminalLocation> {
  const displayName = String(params.displayName || "").trim()
  if (!displayName) throw new Error("Location display name is required")
  assertValidTerminalAddress(params.address)

  const client = new StripeClient()
  const raw = await client.createTerminalLocation(
    {
      display_name: displayName,
      address: {
        line1: params.address.line1.trim(),
        ...(params.address.line2 ? { line2: params.address.line2.trim() } : {}),
        city: params.address.city.trim(),
        state: params.address.state.trim(),
        postal_code: params.address.postalCode.trim(),
        country: params.address.country.trim().toUpperCase()
      }
    },
    params.connectedAccountId
  )

  return normalizeTerminalLocation(raw)
}

export async function listStripeTerminalLocations(params: {
  connectedAccountId: string
}): Promise<StripeTerminalLocation[]> {
  const client = new StripeClient()
  const response = await client.listTerminalLocations(params.connectedAccountId)
  return (response.data || []).map(normalizeTerminalLocation)
}
