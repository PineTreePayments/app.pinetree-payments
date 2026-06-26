import {
  createSpeedWithdrawRequest,
  getPineTreeSpeedConfigStatus,
  type SpeedWithdrawRequestObject,
} from "@/providers/lightning/speedClient"

export type SpeedLightningCapabilities = {
  configured: boolean
  connectAvailable: boolean
  payoutAvailable: boolean
  autoswapAvailable: boolean
  missing: string[]
  apiBaseUrl: string
}

export type SyncSpeedAutoswapSettingsInput = {
  merchantId: string
  enabled: boolean
  destinationAddress: string
  destinationType: string
}

export type CreateSpeedLightningPayoutInput = {
  merchantId: string
  paymentId: string
  amountSats: number
  destinationBtcAddress: string
  destinationType: string
  idempotencyKey: string
}

export function getSpeedLightningCapabilities(): SpeedLightningCapabilities {
  const config = getPineTreeSpeedConfigStatus()
  const missing = [...config.missing]
  const connectAvailable = String(process.env.SPEED_CONNECT_ENABLED || "").trim().toLowerCase() === "true"
  const payoutAvailable = String(process.env.SPEED_PAYOUTS_ENABLED || "").trim().toLowerCase() === "true"
  const autoswapAvailable = String(process.env.SPEED_AUTOSWAP_ENABLED || "").trim().toLowerCase() === "true"

  if (!String(process.env.SPEED_API_BASE_URL || "").trim()) missing.push("SPEED_API_BASE_URL")
  if (!String(process.env.INTERNAL_API_SECRET || "").trim()) missing.push("INTERNAL_API_SECRET")
  if (!payoutAvailable) missing.push("SPEED_PAYOUTS_ENABLED")
  if (!autoswapAvailable) missing.push("SPEED_AUTOSWAP_ENABLED")

  return {
    configured: config.configured,
    connectAvailable,
    payoutAvailable,
    autoswapAvailable,
    missing: [...new Set(missing)],
    apiBaseUrl: config.apiBaseUrl,
  }
}

export async function syncSpeedAutoswapSettings(
  _input: SyncSpeedAutoswapSettingsInput
): Promise<{ synced: false; providerReference: null; status: "not_available"; message: string }> {
  const capabilities = getSpeedLightningCapabilities()
  if (!capabilities.autoswapAvailable) {
    return {
      synced: false,
      providerReference: null,
      status: "not_available",
      message: "Speed autoswap endpoint is not configured for PineTree.",
    }
  }

  // Adapter boundary: wire the concrete Speed autoswap endpoint here once Speed
  // exposes/approves it for PineTree. Do not fake provider sync.
  return {
    synced: false,
    providerReference: null,
    status: "not_available",
    message: "Speed autoswap endpoint is not implemented in this repository.",
  }
}

export async function createSpeedLightningPayout(
  input: CreateSpeedLightningPayoutInput
): Promise<SpeedWithdrawRequestObject> {
  const capabilities = getSpeedLightningCapabilities()
  if (!capabilities.configured || !capabilities.payoutAvailable) {
    throw new Error("PineTree Lightning payout provider is not configured.")
  }

  return createSpeedWithdrawRequest({
    merchantId: input.merchantId,
    paymentId: input.paymentId,
    amount: input.amountSats,
    currency: "SATS",
    destinationBtcAddress: input.destinationBtcAddress,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      source: "pinetree_native_lightning_settlement",
      destination_type: input.destinationType,
    },
  })
}

export async function getSpeedPayoutStatus(
  input: { providerPayoutId?: string | null; providerReference?: string | null }
): Promise<{ status: "not_available"; providerReference: string | null }> {
  return {
    status: "not_available",
    providerReference: input.providerPayoutId || input.providerReference || null,
  }
}
