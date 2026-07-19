/**
 * Non-mutating Speed API capabilities diagnostic.
 * Server-only — never import from client components.
 */

import { getPineTreeSpeedConfigStatus } from "./speedClient"

export { getPineTreeSpeedConfigStatus }

type CapabilityCheck = {
  checked: boolean
  available: boolean
  error?: string
}

export type SpeedCapabilitiesResult = {
  speed_api_configured: boolean
  mode: string
  can_create_invoice: CapabilityCheck
  can_create_send: CapabilityCheck
  can_create_merchant_account: CapabilityCheck
  can_read_balance: CapabilityCheck
  platform_account_id_configured: boolean
  webhook_secret_configured: boolean
  last_error: string | null
}

export async function checkSpeedCapabilities(): Promise<SpeedCapabilitiesResult> {
  const config = getPineTreeSpeedConfigStatus()
  const connectEnabled = process.env.SPEED_CONNECT_ENABLED === "true"
  const configured: CapabilityCheck = { checked: false, available: config.configured }
  const connectedAccountConfigured: CapabilityCheck = {
    checked: false,
    available: config.configured && connectEnabled,
  }

  return {
    speed_api_configured: config.configured,
    mode: config.mode,
    // Runtime calls are authoritative for key permissions. This diagnostic
    // deliberately avoids creating invoices, sends, or connected accounts.
    can_create_invoice: configured,
    can_create_send: connectedAccountConfigured,
    can_create_merchant_account: connectedAccountConfigured,
    can_read_balance: connectedAccountConfigured,
    platform_account_id_configured: config.platformAccountIdConfigured,
    webhook_secret_configured: config.webhookSecretConfigured,
    last_error: config.configured ? null : "SPEED_API_KEY not set",
  }
}
