/**
 * Pure decision helpers for the PineTree Wallet setup timeout and the
 * Dynamic native-auth resume path.
 *
 * When Dynamic's backend rejects the PineTree external JWT (BYOA not approved),
 * setup parks in "needs user auth" and opens Dynamic's native email sheet.
 * Email OTP sign-in routinely takes longer than the wallet provisioning
 * timeout, so the timeout must be suppressed the whole time setup is waiting
 * on the merchant - and once native auth completes, provisioning must resume
 * with a fresh timeout window and no extra "Try Again" click.
 */

export type WalletProvisioningTimeoutContext = {
  /** Merchant-initiated setup is active (pendingSync). */
  pendingSync: boolean
  /** Core setup is parked waiting on Dynamic native auth (external JWT rejected). */
  needsUserAuth: boolean
  /** Dynamic's auth sheet/modal is currently open. */
  dynamicAuthSheetOpen: boolean
  /** A native-auth fallback is pending but the user hasn't completed it yet. */
  nativeFallbackPending: boolean
  /** A POST to /api/wallets/pinetree-profile is currently in flight. */
  profilePostInFlight: boolean
}

/**
 * The provisioning timeout may only run while setup is actively provisioning
 * on its own - never while it is waiting on the merchant to finish Dynamic
 * native auth, and never while a profile save that could still succeed is in
 * flight.
 */
export function shouldRunWalletProvisioningTimeout(ctx: WalletProvisioningTimeoutContext): boolean {
  if (!ctx.pendingSync) return false
  if (ctx.needsUserAuth) return false
  if (ctx.dynamicAuthSheetOpen) return false
  if (ctx.nativeFallbackPending) return false
  if (ctx.profilePostInFlight) return false
  return true
}

export type WalletProvisioningTimeoutSuppressionReason =
  | "needs_user_auth"
  | "dynamic_auth_sheet_open"
  | "native_fallback_pending"
  | "profile_post_in_flight"
  | null

/** Why the timeout is suppressed right now, for the debug beacon. */
export function walletProvisioningTimeoutSuppressionReason(
  ctx: WalletProvisioningTimeoutContext
): WalletProvisioningTimeoutSuppressionReason {
  if (!ctx.pendingSync) return null
  if (ctx.needsUserAuth) return "needs_user_auth"
  if (ctx.dynamicAuthSheetOpen) return "dynamic_auth_sheet_open"
  if (ctx.nativeFallbackPending) return "native_fallback_pending"
  if (ctx.profilePostInFlight) return "profile_post_in_flight"
  return null
}

export type NativeAuthResumeProfileSnapshot = {
  status: string
  base_address: string | null
  solana_address: string | null
} | null

export type NativeAuthResumeAction = "open_existing_ready_wallet" | "resume_core_provisioning"

/**
 * After native auth completes: a profile that is already ready with both core
 * addresses means the wallet exists - open it instead of re-provisioning.
 * Anything else (no profile, pending profile, missing addresses) resumes core
 * provisioning with the now-authenticated Dynamic user.
 */
export function resolveNativeAuthResumeAction(profile: NativeAuthResumeProfileSnapshot): NativeAuthResumeAction {
  if (profile && profile.status === "ready" && profile.base_address && profile.solana_address) {
    return "open_existing_ready_wallet"
  }
  return "resume_core_provisioning"
}

export type SpeedResumeContext = {
  /** A Speed/Lightning provisioning request is already in flight. */
  speedProvisionInFlight: boolean
  /** The Lightning profile state kind as loaded on the client. */
  lightningProfileKind: "loading" | "loaded" | "none" | "error"
}

/**
 * Speed provisioning already ran when the orchestrator first started - the
 * native-auth resume path only re-runs it when no profile/attempt exists at
 * all, so a slow email sign-in can never fan out into repeated Speed calls.
 */
export function shouldRerunSpeedOnNativeAuthResume(ctx: SpeedResumeContext): boolean {
  if (ctx.speedProvisionInFlight) return false
  return ctx.lightningProfileKind === "none"
}
