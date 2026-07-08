/**
 * Speed API capabilities diagnostic.
 * Server-only — never import from client components.
 * Call from /api/internal/speed/capabilities only.
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

function getApiKey(): string {
  return String(process.env.SPEED_API_KEY || "").trim()
}

function getBaseUrl(): string {
  return (process.env.SPEED_API_BASE_URL || "https://api.tryspeed.com").replace(/\/$/, "")
}

async function trySpeedEndpoint(
  path: string,
  method: "GET" | "POST",
  body?: object
): Promise<{ ok: boolean; status: number; error?: string }> {
  const apiKey = getApiKey()
  if (!apiKey) return { ok: false, status: 0, error: "SPEED_API_KEY not set" }

  const authToken = Buffer.from(`${apiKey}:`).toString("base64")

  try {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    if (res.ok) return { ok: true, status: res.status }

    // 4xx errors tell us about permissions, not connectivity
    const text = await res.text().catch(() => "")
    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "Network error",
    }
  }
}

export async function checkSpeedCapabilities(): Promise<SpeedCapabilitiesResult> {
  const config = getPineTreeSpeedConfigStatus()
  let lastError: string | null = null

  // Invoice creation: POST /payments with a tiny probe amount
  const invoiceProbe = await trySpeedEndpoint("/payments", "POST", {
    currency: "USD",
    amount: 0.01,
    target_currency: "SATS",
    payment_methods: ["lightning"],
    metadata: { probe: true },
  })
  const canCreateInvoice: CapabilityCheck = {
    checked: true,
    available: invoiceProbe.ok || invoiceProbe.status === 422,
    error: invoiceProbe.ok || invoiceProbe.status === 422 ? undefined : invoiceProbe.error,
  }
  if (canCreateInvoice.error) lastError = canCreateInvoice.error

  // POST /send (withdraw / instant send) — probe with invalid body; 422 = endpoint reachable
  const sendProbe = await trySpeedEndpoint("/send", "POST", { probe: true })
  const canCreateSend: CapabilityCheck = {
    checked: true,
    available: sendProbe.ok || sendProbe.status === 422 || sendProbe.status === 400,
    error:
      sendProbe.ok || sendProbe.status === 422 || sendProbe.status === 400
        ? undefined
        : sendProbe.error,
  }
  if (canCreateSend.error && !lastError) lastError = canCreateSend.error

  // Merchant / sub-account creation — Speed Custom Connect endpoint
  const accountProbe = await trySpeedEndpoint("/connect/custom", "POST", { probe: true })
  const canCreateMerchantAccount: CapabilityCheck = {
    checked: true,
    available:
      accountProbe.ok || accountProbe.status === 422 || accountProbe.status === 400,
    error:
      accountProbe.ok || accountProbe.status === 422 || accountProbe.status === 400
        ? undefined
        : accountProbe.status === 403 || accountProbe.status === 404
          ? `Endpoint not available for this key (${accountProbe.status})`
          : accountProbe.error,
  }
  if (canCreateMerchantAccount.error && !lastError) lastError = canCreateMerchantAccount.error

  // Balance / account read
  const balanceProbe = await trySpeedEndpoint("/account", "GET")
  const canReadBalance: CapabilityCheck = {
    checked: true,
    available: balanceProbe.ok,
    error: balanceProbe.ok ? undefined : balanceProbe.error,
  }
  if (canReadBalance.error && !lastError) lastError = canReadBalance.error

  return {
    speed_api_configured: config.configured,
    mode: config.mode,
    can_create_invoice: canCreateInvoice,
    can_create_send: canCreateSend,
    can_create_merchant_account: canCreateMerchantAccount,
    can_read_balance: canReadBalance,
    platform_account_id_configured: config.platformAccountIdConfigured,
    webhook_secret_configured: config.webhookSecretConfigured,
    last_error: lastError,
  }
}
