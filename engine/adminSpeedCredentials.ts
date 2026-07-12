/**
 * Internal-only PineTree administrative access to retained Speed Custom
 * Connect credentials. Every export here must only ever be called after
 * requireAdminFromRequest has resolved - see
 * app/api/admin/speed-credentials/route.ts and
 * app/api/admin/speed-credentials/[merchantId]/reveal/route.ts.
 *
 * Never import this module from a merchant-facing route, the PineTree
 * Wallet page, the providers page, or any client component. Merchants must
 * only ever see PineTree-branded Lightning/PineTree Wallet status - never
 * Speed, a Speed account id, a Speed login email, or a Speed password.
 */

import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"
import {
  deriveSpeedCredentialStatus,
  getMerchantSpeedCredentialMetadata,
  resolveSpeedCredentialEnvironment,
  revealMerchantSpeedCredential,
  type SpeedCredentialEnvironment,
  type SpeedCredentialStatus,
} from "@/database/merchantSpeedCredentials"

const CREDENTIAL_STORE_FAILED_STATUS = "speed_connect_credential_store_failed"

export type AdminSpeedCredentialSummary = {
  merchantId: string
  environment: SpeedCredentialEnvironment
  status: SpeedCredentialStatus
  speedConnectedAccountId: string | null
  speedLoginEmail: string | null
  createdAt: string | null
  updatedAt: string | null
  rotatedAt: string | null
}

/**
 * Non-secret summary - safe for an admin list/detail view. Never includes
 * the password.
 */
export async function getAdminSpeedCredentialSummary(
  merchantId: string,
  environment: SpeedCredentialEnvironment = resolveSpeedCredentialEnvironment()
): Promise<AdminSpeedCredentialSummary> {
  const [metadata, lightningProfile] = await Promise.all([
    getMerchantSpeedCredentialMetadata(merchantId, environment),
    getMerchantLightningProfile(merchantId),
  ])

  const status = deriveSpeedCredentialStatus({
    hasStoredCredential: Boolean(metadata),
    credentialStoreFailed: lightningProfile?.speed_connected_account_status === CREDENTIAL_STORE_FAILED_STATUS,
  })

  return {
    merchantId,
    environment,
    status,
    speedConnectedAccountId:
      metadata?.speed_connected_account_id ??
      lightningProfile?.speed_account_id ??
      lightningProfile?.speed_connected_account_id ??
      null,
    speedLoginEmail: metadata?.speed_login_email ?? null,
    createdAt: metadata?.created_at ?? null,
    updatedAt: metadata?.updated_at ?? null,
    rotatedAt: metadata?.rotated_at ?? null,
  }
}

export type RevealedSpeedCredential = {
  speedConnectedAccountId: string
  speedLoginEmail: string
  speedPassword: string
}

/**
 * Decrypts and returns a merchant's retained Speed password for an
 * authorized PineTree administrator. Audits the reveal event (never the
 * password itself) before returning. Throws if no credential is on file.
 */
export async function revealAdminSpeedCredential(input: {
  merchantId: string
  adminId: string
  environment?: SpeedCredentialEnvironment
}): Promise<RevealedSpeedCredential> {
  const environment = input.environment ?? resolveSpeedCredentialEnvironment()
  const credential = await revealMerchantSpeedCredential(input.merchantId, environment)
  if (!credential) {
    throw new Error("No retained Speed credential is available for this merchant/environment.")
  }

  await insertMerchantAuditEvent({
    merchantId: input.merchantId,
    eventType: "lightning.speed_credential_revealed",
    actorId: input.adminId,
    metadata: {
      environment,
      speed_connected_account_id: credential.speedConnectedAccountId,
    },
  })

  return credential
}
