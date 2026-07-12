/**
 * Server-only access to merchant_speed_credentials - retained login
 * credentials for PineTree-created Speed Custom Connect accounts.
 *
 * SECURITY: This table has no anon/authenticated RLS policies at all (see
 * database/migrations/20260712_create_merchant_speed_credentials.sql) - only
 * the service-role client can read or write it. Never call this module from
 * a merchant-facing route. Callers that need the decrypted password must be
 * an authorized PineTree administrator (see engine/adminSpeedCredentials.ts).
 */

import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"
import { encryptSpeedAccountPassword, decryptSpeedAccountPassword } from "@/providers/lightning/speedCredentialCrypto"

const supabase = supabaseAdmin || supabaseAnon

const TABLE = "merchant_speed_credentials"

export type SpeedCredentialEnvironment = "production" | "non_production"

export type MerchantSpeedCredentialMetadata = {
  id: string
  merchant_id: string
  speed_connected_account_id: string
  speed_login_email: string
  environment: SpeedCredentialEnvironment
  created_at: string
  updated_at: string
  rotated_at: string | null
}

export type SpeedCredentialStatus = "available" | "unavailable" | "storage_error"

const METADATA_COLUMNS =
  "id,merchant_id,speed_connected_account_id,speed_login_email,environment,created_at,updated_at,rotated_at"

/**
 * Mirrors the codebase's one production/non-production convention
 * (process.env.NODE_ENV === "production", see engine/config.ts and
 * engine/pineTreeWalletReadiness.ts's isProductionRuntime).
 */
export function resolveSpeedCredentialEnvironment(): SpeedCredentialEnvironment {
  return process.env.NODE_ENV === "production" ? "production" : "non_production"
}

/**
 * Encrypts and stores a PineTree-created Speed Custom Connect account's
 * login password. Only call this immediately after Speed's /connect/custom
 * call succeeds with a password PineTree actually just set - never for an
 * account that was resolved via an existing-account lookup (that password is
 * unknown to PineTree and must not be fabricated).
 *
 * Upserts on (merchant_id, environment) - retrying provisioning for the same
 * merchant/environment updates the retained credential rather than creating a
 * second row.
 */
export async function upsertMerchantSpeedCredential(input: {
  merchantId: string
  speedConnectedAccountId: string
  speedLoginEmail: string
  password: string
  environment?: SpeedCredentialEnvironment
}): Promise<MerchantSpeedCredentialMetadata> {
  const environment = input.environment ?? resolveSpeedCredentialEnvironment()
  const encrypted = encryptSpeedAccountPassword(input.password)
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        merchant_id: input.merchantId,
        speed_connected_account_id: input.speedConnectedAccountId,
        speed_login_email: input.speedLoginEmail,
        encrypted_password: encrypted.encryptedPassword,
        encryption_iv: encrypted.encryptionIv,
        encryption_auth_tag: encrypted.encryptionAuthTag,
        environment,
        updated_at: now,
      },
      { onConflict: "merchant_id,environment" }
    )
    .select(METADATA_COLUMNS)
    .single()

  if (error || !data) {
    throw new Error(`Failed to store Speed account credential: ${error?.message ?? "unknown error"}`)
  }

  return data as MerchantSpeedCredentialMetadata
}

/**
 * Non-secret metadata only - safe for an admin summary view. Never selects
 * encrypted_password/encryption_iv/encryption_auth_tag.
 */
export async function getMerchantSpeedCredentialMetadata(
  merchantId: string,
  environment: SpeedCredentialEnvironment = resolveSpeedCredentialEnvironment()
): Promise<MerchantSpeedCredentialMetadata | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(METADATA_COLUMNS)
    .eq("merchant_id", merchantId)
    .eq("environment", environment)
    .maybeSingle()

  if (error || !data) return null
  return data as MerchantSpeedCredentialMetadata
}

/**
 * Decrypts and returns a merchant's stored Speed account password. Callers
 * MUST already be an authorized PineTree administrator and MUST audit this
 * call - see engine/adminSpeedCredentials.ts.revealAdminSpeedCredential and
 * app/api/admin/speed-credentials/[merchantId]/reveal/route.ts. Never cache,
 * log, or persist the returned password.
 */
export async function revealMerchantSpeedCredential(
  merchantId: string,
  environment: SpeedCredentialEnvironment = resolveSpeedCredentialEnvironment()
): Promise<{ speedConnectedAccountId: string; speedLoginEmail: string; speedPassword: string } | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("speed_connected_account_id,speed_login_email,encrypted_password,encryption_iv,encryption_auth_tag")
    .eq("merchant_id", merchantId)
    .eq("environment", environment)
    .maybeSingle()

  if (error || !data) return null

  const row = data as {
    speed_connected_account_id: string
    speed_login_email: string
    encrypted_password: string
    encryption_iv: string
    encryption_auth_tag: string
  }

  const speedPassword = decryptSpeedAccountPassword({
    encryptedPassword: row.encrypted_password,
    encryptionIv: row.encryption_iv,
    encryptionAuthTag: row.encryption_auth_tag,
  })

  return {
    speedConnectedAccountId: row.speed_connected_account_id,
    speedLoginEmail: row.speed_login_email,
    speedPassword,
  }
}

/**
 * Derives a merchant's credential-recovery status without touching the
 * encrypted value. `credentialStoreFailed` should be true when the
 * merchant's Lightning profile is currently flagged
 * speed_connect_credential_store_failed (Speed created the account but
 * PineTree failed to retain its password) - see
 * engine/pineTreeWalletReadiness.ts.
 */
export function deriveSpeedCredentialStatus(input: {
  hasStoredCredential: boolean
  credentialStoreFailed: boolean
}): SpeedCredentialStatus {
  if (input.credentialStoreFailed) return "storage_error"
  return input.hasStoredCredential ? "available" : "unavailable"
}
