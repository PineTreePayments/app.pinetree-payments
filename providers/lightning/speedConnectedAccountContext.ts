import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { getPineTreeSpeedConfigStatus } from "./speedClient"
import { resolveSpeedHeaderAccountId } from "./speedHeaderAccountResolver"

export type SpeedConnectedAccountContext = {
  merchantId: string
  connectedAccountId: string
  connectedRelationshipId: string | null
  platformAccountId: string | null
  accountStatus: string | null
  providerReady: boolean
  maskedAccountSuffix: string | null
}

export type SpeedConnectedAccountContextFailureCode =
  | "SPEED_PROFILE_MISSING"
  | "SPEED_PROFILE_NOT_READY"
  | "SPEED_CONNECTED_ACCOUNT_MISSING"
  | "SPEED_CONNECTED_ACCOUNT_INVALID"

export class SpeedConnectedAccountContextError extends Error {
  readonly code: SpeedConnectedAccountContextFailureCode
  readonly merchantId: string

  constructor(code: SpeedConnectedAccountContextFailureCode, merchantId: string) {
    super(speedConnectedAccountContextMessage(code))
    this.name = "SpeedConnectedAccountContextError"
    this.code = code
    this.merchantId = merchantId
  }
}

function speedConnectedAccountContextMessage(code: SpeedConnectedAccountContextFailureCode) {
  if (code === "SPEED_PROFILE_MISSING") return "Speed connected account profile is missing."
  if (code === "SPEED_PROFILE_NOT_READY") return "Speed connected account is not ready."
  if (code === "SPEED_CONNECTED_ACCOUNT_INVALID") return "Speed connected account ID is invalid."
  return "Speed connected account ID is missing."
}

function speedAccountSuffix(value: string | null | undefined) {
  const account = String(value || "").trim()
  return account ? account.slice(-6) : null
}

function platformAccountIdFromConfig() {
  const config = getPineTreeSpeedConfigStatus()
  return config.platformAccountIdConfigured
    ? String(process.env.SPEED_PLATFORM_ACCOUNT_ID || "").trim() || null
    : null
}

export async function resolveSpeedConnectedAccountContext(
  merchantId: string
): Promise<SpeedConnectedAccountContext> {
  console.info("[pinetree-withdrawals] SPEED_CONTEXT_RESOLUTION_STARTED", {
    merchantId,
    routeStage: "speed_context_resolution_started",
  })
  const profile = await getMerchantLightningProfile(merchantId)
  if (!profile) {
    console.warn("[pinetree-withdrawals] SPEED_CONNECTED_ACCOUNT_MISSING", {
      merchantId,
      normalizedErrorCode: "SPEED_PROFILE_MISSING",
      routeStage: "speed_connected_account_missing",
    })
    throw new SpeedConnectedAccountContextError("SPEED_PROFILE_MISSING", merchantId)
  }
  if (profile.status !== "ready") {
    console.warn("[pinetree-withdrawals] SPEED_CONNECTED_ACCOUNT_MISSING", {
      merchantId,
      normalizedErrorCode: "SPEED_PROFILE_NOT_READY",
      routeStage: "speed_connected_account_missing",
    })
    throw new SpeedConnectedAccountContextError("SPEED_PROFILE_NOT_READY", merchantId)
  }

  let connectedAccountId: string
  try {
    connectedAccountId = resolveSpeedHeaderAccountId(profile)
  } catch (error) {
    const reason = error && typeof error === "object" && "reason" in error
      ? String((error as { reason?: unknown }).reason || "")
      : ""
    const code =
      reason === "invalid_format" || reason === "mismatch"
        ? "SPEED_CONNECTED_ACCOUNT_INVALID"
        : "SPEED_CONNECTED_ACCOUNT_MISSING"
    console.warn("[pinetree-withdrawals] SPEED_CONNECTED_ACCOUNT_MISSING", {
      merchantId,
      normalizedErrorCode: code,
      routeStage: "speed_connected_account_missing",
    })
    throw new SpeedConnectedAccountContextError(code, merchantId)
  }

  if (!connectedAccountId.startsWith("acct_")) {
    console.warn("[pinetree-withdrawals] SPEED_CONNECTED_ACCOUNT_MISSING", {
      merchantId,
      normalizedErrorCode: "SPEED_CONNECTED_ACCOUNT_INVALID",
      routeStage: "speed_connected_account_missing",
    })
    throw new SpeedConnectedAccountContextError("SPEED_CONNECTED_ACCOUNT_INVALID", merchantId)
  }

  const context = {
    merchantId,
    connectedAccountId,
    connectedRelationshipId: profile.speed_connected_account_relationship_id || null,
    platformAccountId: platformAccountIdFromConfig(),
    accountStatus: profile.speed_connected_account_status || null,
    providerReady: true,
    maskedAccountSuffix: speedAccountSuffix(connectedAccountId),
  }
  console.info("[pinetree-withdrawals] SPEED_CONNECTED_ACCOUNT_RESOLVED", {
    merchantId,
    speedAccountSuffix: context.maskedAccountSuffix,
    relationshipIdPresent: Boolean(context.connectedRelationshipId),
    accountStatus: context.accountStatus,
    routeStage: "speed_connected_account_resolved",
  })
  console.info("[pinetree-withdrawals] SPEED_HEADER_CONTEXT_READY", {
    merchantId,
    headerName: "speed-account",
    speedAccountSuffix: context.maskedAccountSuffix,
    routeStage: "speed_header_context_ready",
  })
  return context
}
