import { after, type NextRequest, NextResponse } from "next/server"
import { requireMerchantAuthFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import {
  findPineTreeWalletProfileByAddress,
  getPineTreeWalletProfile,
  inferBtcAddressType,
  normalizeBtcAddressType,
  pineTreeWalletProfileHasProtectedHistory,
  upsertPineTreeWalletProfile
} from "@/database/pineTreeWalletProfiles"
import { getMerchantByAuthUserId, getMerchantById } from "@/database/merchants"
import { syncPineTreeWalletProfileProviders } from "@/database/pineTreeWalletProfileProviderSync"
import { provisionMerchantBitcoinAddress } from "@/engine/pineTreeBitcoinAddressProvisioning"
import { isDynamicBtcLegacyEnabled } from "@/lib/pinetreeDynamicBtcLegacy"
import { assertMerchantBusinessProfileComplete } from "@/engine/businessProfile"
import { withOperationTimeout } from "@/engine/promiseTimeout"

const BACKGROUND_PROVISIONING_TIMEOUT_MS = 12_000
const BUSINESS_PROFILE_REQUIRED_MESSAGE = "Complete your Business Profile before creating your PineTree Wallet."

function profileHasReadyCoreIdentity(profile: Awaited<ReturnType<typeof getPineTreeWalletProfile>>) {
  return Boolean(
    profile &&
    profile.status === "ready" &&
    profile.base_address &&
    profile.solana_address
  )
}

type WalletIdentityConflictType =
  | "base_owned_by_other_merchant"
  | "solana_owned_by_other_merchant"
  | "protected_existing_profile"

function normalizedString(value: unknown) {
  return String(value || "").trim() || null
}

function profileIdentityDiagnostics(input: {
  authUserPresent: boolean
  merchantResolved: boolean
  merchantBelongsToAuthUser: boolean
  requestMerchantIdPresent: boolean
  requestMerchantMatchesResolvedMerchant: boolean
  dynamicExternalUserIdPresent: boolean
  dynamicExternalUserMatchesResolvedMerchant: boolean
  profileOwnershipChecksReached: boolean
}) {
  return input
}

function walletProfileAuthDiagnostics(input: {
  authUserPresent: boolean
  canonicalMerchantResolved: boolean
  fallbackMerchantResolved: boolean
  merchantOwnershipConfirmed: boolean
  status: number
}) {
  return input
}

async function resolveProfileMerchant(auth: Awaited<ReturnType<typeof requireMerchantAuthFromRequest>>) {
  const authUserId = auth.authUserId || auth.merchantId
  if (auth.source === "api_key") {
    return {
      authUserId,
      merchant: { id: auth.merchantId, user_id: authUserId },
      merchantId: auth.merchantId,
      merchantBelongsToAuthUser: Boolean(auth.merchantId),
      canonicalMerchantResolved: Boolean(auth.merchantId),
      fallbackMerchantResolved: false,
    }
  }

  const canonicalMerchant = await getMerchantById(auth.merchantId)
  if (canonicalMerchant) {
    return {
      authUserId,
      merchant: canonicalMerchant,
      merchantId: canonicalMerchant.id,
      merchantBelongsToAuthUser: true,
      canonicalMerchantResolved: true,
      fallbackMerchantResolved: false,
    }
  }

  const fallbackMerchant = await getMerchantByAuthUserId(authUserId)
  const merchantId = String(fallbackMerchant?.id || "").trim()
  return {
    authUserId,
    merchant: fallbackMerchant,
    merchantId,
    merchantBelongsToAuthUser: Boolean(merchantId),
    canonicalMerchantResolved: false,
    fallbackMerchantResolved: Boolean(merchantId),
  }
}

function scheduleWalletReadiness(profile: Awaited<ReturnType<typeof upsertPineTreeWalletProfile>>) {
  after(async () => {
    const providerSyncStartedAt = Date.now()
    console.info("[pinetree-wallets] background_step", {
      merchant_id: profile.merchant_id,
      step: "provider_sync_start",
    })
    console.info("[pinetree-wallets] wallet_provider_sync_background_started", { merchantId: profile.merchant_id })
    try {
      await withOperationTimeout(
        syncPineTreeWalletProfileProviders(profile),
        BACKGROUND_PROVISIONING_TIMEOUT_MS,
        "wallet provider sync"
      )
    } catch (error) {
      console.warn("[pinetree-wallets] background_provider_sync_failed", {
        merchantId: profile.merchant_id,
        error: error instanceof Error ? error.message : String(error),
      })
      console.warn("[pinetree-wallets] wallet_provider_sync_background_failed", { merchantId: profile.merchant_id })
    } finally {
      console.info("[pinetree-wallets] background_timing", {
        merchant_id: profile.merchant_id,
        step: "provider_sync_complete",
        duration_ms: Date.now() - providerSyncStartedAt,
      })
    }
  })
}

/**
 * POST /api/wallets/pinetree-profile
 * Creates or updates the PineTree Wallet profile for the authenticated merchant.
 * Only the wallet owner/address fields provided in the body are written; omitted fields keep their value.
 *
 * Body (all optional):
 *   dynamic_user_id             string | null   Dynamic user id that owns embedded wallets
 *   dynamic_external_user_id    string | null   PineTree merchant id from the Dynamic external-user credential
 *   base_address           string | null
 *   solana_address         string | null
 *   bitcoin_lightning_address  string | null
 *   bitcoin_onchain_address    string | null
 *   btc_address                string | null
 *   btc_address_type           "taproot" | "native_segwit" | "legacy" | "nested_segwit" | "unknown" | null
 *
 * Dynamic Base/Solana profile sync does not provision BTC. BTC payout fields
 * are updated only when an explicit BTC address is supplied.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireMerchantAuthFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>
    const resolved = await resolveProfileMerchant(auth)
    const authUserId = resolved.authUserId
    const requestMerchantId = normalizedString(body.merchant_id)
    const merchantId = resolved.merchantId
    const syncsDynamicProfile =
      "dynamic_user_id" in body ||
      "dynamic_external_user_id" in body ||
      "dynamic_email" in body ||
      "base_address" in body ||
      "solana_address" in body
    const dynamicUserId = syncsDynamicProfile ? normalizedString(body.dynamic_user_id) : null
    const legacyExternalUserId = dynamicUserId && dynamicUserId === merchantId ? dynamicUserId : null
    const dynamicExternalUserId = syncsDynamicProfile
      ? normalizedString(body.dynamic_external_user_id) || legacyExternalUserId
      : null
    const baseIdentityDiagnostics = {
      authUserPresent: Boolean(authUserId),
      merchantResolved: Boolean(merchantId),
      merchantBelongsToAuthUser: resolved.merchantBelongsToAuthUser,
      requestMerchantIdPresent: Boolean(requestMerchantId),
      requestMerchantMatchesResolvedMerchant: Boolean(requestMerchantId && merchantId && requestMerchantId === merchantId),
      dynamicExternalUserIdPresent: Boolean(dynamicExternalUserId),
      dynamicExternalUserMatchesResolvedMerchant: Boolean(dynamicExternalUserId && merchantId && dynamicExternalUserId === merchantId),
      profileOwnershipChecksReached: false,
    }
    if (!merchantId) {
      const requestedMerchantExists = requestMerchantId
        ? Boolean(await getMerchantById(requestMerchantId))
        : false
      const reason = requestedMerchantExists ? "merchant_not_owned_by_auth_user" : "merchant_not_resolved"
      console.warn("[pinetree-wallets] wallet_profile_identity_check_failed", {
        reason,
        ...profileIdentityDiagnostics(baseIdentityDiagnostics),
      })
      return NextResponse.json({ error: reason, retryable: true }, { status: 403 })
    }

    console.info("[pinetree-wallets] wallet_profile_post_start", { merchantId })
    console.info("[pinetree-wallets] profile_route_post_received", {
      merchantId,
      dynamicUserIdPresent: Boolean(body.dynamic_user_id),
      dynamicExternalUserIdPresent: Boolean(dynamicExternalUserId),
      baseAddressPresent: Boolean(body.base_address),
      solanaAddressPresent: Boolean(body.solana_address),
      btcAddressInputPresent: "btc_address" in body || "bitcoin_onchain_address" in body,
    })
    if (body.action === "reset_dynamic_wallet_profile") {
      const profile = await upsertPineTreeWalletProfile({
        merchantId,
        dynamicUserId: null,
        dynamicEmail: null,
        baseAddress: null,
        solanaAddress: null,
        bitcoinLightningAddress: null,
        bitcoinOnchainAddress: null,
      })
      console.info("[pinetree-wallets] profile_route_reset_success", {
        merchantId,
        profileId: profile.id,
        profileMerchantId: profile.merchant_id,
      })
      return NextResponse.json({ profile, merchantId })
    }

    try {
      await assertMerchantBusinessProfileComplete(merchantId)
    } catch (error) {
      if (getRouteErrorStatus(error) === 409) {
        console.warn("[pinetree-wallets] wallet_profile_business_profile_required", { merchantId })
        return NextResponse.json(
          {
            error: "business_profile_required",
            code: "business_profile_required",
            message: BUSINESS_PROFILE_REQUIRED_MESSAGE,
            retryable: false,
          },
          { status: 409 }
        )
      }
      throw error
    }

    const incomingBaseAddress = "base_address" in body ? normalizedString(body.base_address) : undefined
    const incomingSolanaAddress = "solana_address" in body ? normalizedString(body.solana_address) : undefined
    const existingProfile = await getPineTreeWalletProfile(merchantId)
    if (syncsDynamicProfile) {
      if (!dynamicExternalUserId) {
        console.warn("[pinetree-wallets] wallet_profile_identity_check_failed", {
          reason: "dynamic_external_user_missing",
          ...profileIdentityDiagnostics(baseIdentityDiagnostics),
        })
        return NextResponse.json(
          {
            error: "dynamic_external_user_missing",
            retryable: true,
          },
          { status: 400 }
        )
      }
      if (dynamicExternalUserId !== merchantId) {
        const diagnostics = {
          ...baseIdentityDiagnostics,
          dynamicExternalUserIdPresent: true,
          dynamicExternalUserMatchesResolvedMerchant: false,
        }
        console.warn("[pinetree-wallets] wallet_profile_identity_check_failed", {
          reason: "dynamic_external_user_merchant_mismatch",
          ...profileIdentityDiagnostics(diagnostics),
        })
        return NextResponse.json(
          {
            error: "dynamic_external_user_merchant_mismatch",
            retryable: true,
          },
          { status: 400 }
        )
      }
      if (!dynamicUserId) {
        console.warn("[pinetree-wallets] wallet_profile_identity_check_failed", {
          reason: "dynamic_user_missing",
          ...profileIdentityDiagnostics(baseIdentityDiagnostics),
        })
        return NextResponse.json(
          {
            error: "dynamic_user_missing",
            retryable: true,
          },
          { status: 400 }
        )
      }
    }

    const hasBtcAddressInput = "btc_address" in body || "bitcoin_onchain_address" in body
    const bodyBtcAddress = "btc_address" in body
      ? (body.btc_address as string | null)
      : "bitcoin_onchain_address" in body
        ? (body.bitcoin_onchain_address as string | null)
        : undefined
    const normalizedBtcAddress = typeof bodyBtcAddress === "string" ? bodyBtcAddress.trim() || null : bodyBtcAddress
    const btcAddressType = "btc_address_type" in body
      ? normalizeBtcAddressType(body.btc_address_type as string | null)
      : normalizedBtcAddress
        ? inferBtcAddressType(normalizedBtcAddress)
        : undefined

    if (syncsDynamicProfile) {
      const { baseProfile, solanaProfile } = await findPineTreeWalletProfileByAddress({
        baseAddress: incomingBaseAddress,
        solanaAddress: incomingSolanaAddress,
      })
      const existingReadyProfile = profileHasReadyCoreIdentity(existingProfile)
      const baseAddressOwnedBySameMerchant = Boolean(baseProfile?.merchant_id === merchantId)
      const solanaAddressOwnedBySameMerchant = Boolean(solanaProfile?.merchant_id === merchantId)
      const baseAddressOwnedByAnotherMerchant = Boolean(baseProfile && baseProfile.merchant_id !== merchantId)
      const solanaAddressOwnedByAnotherMerchant = Boolean(solanaProfile && solanaProfile.merchant_id !== merchantId)
      const dynamicUserMatchesExistingProfile = Boolean(
        existingProfile?.dynamic_user_id &&
          dynamicUserId &&
          existingProfile.dynamic_user_id === dynamicUserId
      )
      const existingProfileProtected = await pineTreeWalletProfileHasProtectedHistory(existingProfile?.id)
      const existingProfileRepairable = Boolean(existingProfile && !existingProfileProtected)
      const ownershipDiagnostics = {
        ...profileIdentityDiagnostics({
          ...baseIdentityDiagnostics,
          profileOwnershipChecksReached: true,
        }),
        existingProfileForMerchant: Boolean(existingProfile),
        existingProfileStatus: existingProfile?.status ?? null,
        baseAddressOwnedBySameMerchant,
        solanaAddressOwnedBySameMerchant,
        baseAddressOwnedByAnotherMerchant,
        solanaAddressOwnedByAnotherMerchant,
        dynamicUserMatchesExistingProfile,
        existingProfileRepairable,
      }
      const conflictType: WalletIdentityConflictType | null = baseAddressOwnedByAnotherMerchant
        ? "base_owned_by_other_merchant"
        : solanaAddressOwnedByAnotherMerchant
          ? "solana_owned_by_other_merchant"
          : existingProfileProtected &&
              existingProfile &&
              Boolean(
                (incomingBaseAddress && existingProfile.base_address && incomingBaseAddress !== existingProfile.base_address) ||
                (incomingSolanaAddress && existingProfile.solana_address && incomingSolanaAddress !== existingProfile.solana_address)
              )
            ? "protected_existing_profile"
            : null

      if (conflictType) {
        console.warn("[pinetree-wallets] wallet_profile_post_conflict", {
          reason: conflictType,
          conflictType,
          ...ownershipDiagnostics,
        })
        console.warn("[pinetree-wallets] wallet_profile_identity_check_failed", {
          reason: conflictType,
          conflictType,
          ...ownershipDiagnostics,
        })
        return NextResponse.json(
          {
            error: conflictType,
            conflictType,
            status: "needs_review",
            message: "This wallet does not match the one already saved for your account. Please contact support before continuing.",
            retryable: false,
          },
          { status: 409 }
        )
      }

      if (existingReadyProfile && baseAddressOwnedBySameMerchant && solanaAddressOwnedBySameMerchant) {
        const readyProfile = existingProfile!
        console.info("[pinetree-wallets] wallet_profile_post_idempotent_success", {
          merchantId,
          profileId: readyProfile.id,
          status: readyProfile.status,
        })
        return NextResponse.json({
          profile: readyProfile,
          merchantId,
          providerSync: { status: "pending" as const },
          setupStatus: "ready" as const,
        })
      }
    }

    const shouldLogIncompleteRepair = Boolean(
      syncsDynamicProfile &&
      existingProfile &&
      !profileHasReadyCoreIdentity(existingProfile) &&
      body.base_address &&
      body.solana_address
    )

    const dynamicBtcLegacyEnabled = isDynamicBtcLegacyEnabled()
    if (hasBtcAddressInput && !dynamicBtcLegacyEnabled) {
      console.info("[pinetree-wallets] dynamic_btc_profile_input_ignored", {
        merchantId,
        btcAddressInputPresent: true,
        dynamicBtcLegacyEnabled: false,
      })
    }
    const bitcoinProvisioning = dynamicBtcLegacyEnabled && hasBtcAddressInput && normalizedBtcAddress
      ? await provisionMerchantBitcoinAddress({
        merchantId,
        existingProfile,
        dynamicBtcAddress: normalizedBtcAddress,
        dynamicBtcAddressType: btcAddressType,
      })
      : null
    const provisionedBtcAddress = bitcoinProvisioning?.btcAddress
      ? bitcoinProvisioning.btcAddress.trim()
      : null
    const now = new Date().toISOString()
    const btcAddressAlreadyExists = bitcoinProvisioning?.status === "already_exists"
    const btcAddressIsReady = Boolean(provisionedBtcAddress)

    const profileSaveStartedAt = Date.now()
    const profile = await upsertPineTreeWalletProfile({
      merchantId,
      dynamicUserId: "dynamic_user_id" in body ? dynamicUserId : undefined,
      dynamicEmail: "dynamic_email" in body ? (body.dynamic_email as string | null) : undefined,
      baseAddress: "base_address" in body ? (body.base_address as string | null) : undefined,
      solanaAddress: "solana_address" in body ? (body.solana_address as string | null) : undefined,
      bitcoinLightningAddress: "bitcoin_lightning_address" in body ? (body.bitcoin_lightning_address as string | null) : undefined,
      bitcoinOnchainAddress: dynamicBtcLegacyEnabled && "bitcoin_onchain_address" in body ? (body.bitcoin_onchain_address as string | null) : undefined,
      bitcoinLightningStatus: "bitcoin_lightning_status" in body ? (body.bitcoin_lightning_status as "not_configured" | "pending" | "ready" | "needs_attention" | undefined) : undefined,
      bitcoinLightningProvider: "bitcoin_lightning_provider" in body ? (body.bitcoin_lightning_provider as string | null) : undefined,
      bitcoinLightningAccountId: "bitcoin_lightning_account_id" in body ? (body.bitcoin_lightning_account_id as string | null) : undefined,
      btcAddress: btcAddressIsReady && !btcAddressAlreadyExists ? provisionedBtcAddress : undefined,
      btcAddressType: btcAddressIsReady && !btcAddressAlreadyExists ? bitcoinProvisioning?.btcAddressType : undefined,
      btcWalletProvider: btcAddressIsReady && !btcAddressAlreadyExists
        ? bitcoinProvisioning?.btcWalletProvider
        : bitcoinProvisioning?.status === "missing_provider" || bitcoinProvisioning?.status === "provider_failed"
          ? bitcoinProvisioning.btcWalletProvider
          : undefined,
      btcWalletProviderRef: btcAddressIsReady && !btcAddressAlreadyExists ? bitcoinProvisioning?.providerRef ?? null : undefined,
      btcWalletLastProvisionedAt: btcAddressIsReady && !btcAddressAlreadyExists ? now : undefined,
      btcWalletProvisioningStatus: bitcoinProvisioning?.status,
      btcWalletProvisioningError: bitcoinProvisioning ? bitcoinProvisioning.error || null : undefined,
      btcPayoutEnabled: btcAddressIsReady || btcAddressAlreadyExists ? true : undefined,
      btcPayoutVerifiedAt: btcAddressIsReady || (btcAddressAlreadyExists && !existingProfile?.btc_payout_verified_at)
        ? now
        : undefined,
    })
    console.info("[pinetree-wallets] profile_timing", {
      merchant_id: merchantId,
      step: "core_profile_saved",
      duration_ms: Date.now() - profileSaveStartedAt,
    })
    if (shouldLogIncompleteRepair) {
      console.info("[pinetree-wallets] wallet_profile_post_existing_incomplete_repaired", {
        merchantId,
        profileId: profile.id,
        status: profile.status,
      })
    }

    scheduleWalletReadiness(profile)
    const providerSync = { status: "pending" as const }
    const setupStatus = profile.status === "ready" ? "ready" : "pending"

    console.info("[pinetree-wallets] profile_route_upsert_success", {
      merchantId,
      profileId: profile.id,
      profileMerchantId: profile.merchant_id,
      dynamicUserIdPersisted: Boolean(profile.dynamic_user_id),
      baseAddressPersisted: Boolean(profile.base_address),
      solanaAddressPersisted: Boolean(profile.solana_address),
      status: profile.status,
      btcAddressPersisted: Boolean(profile.btc_address),
      btcPayoutEnabled: Boolean(profile.btc_payout_enabled),
      bitcoinProvisioningStatus: bitcoinProvisioning?.status ?? "not_requested",
      providerSync,
      setupStatus,
    })
    console.info("[pinetree-wallets] wallet_profile_post_success", { merchantId, status: profile.status })
    if (profile.status === "ready") {
      console.info("[pinetree-wallets] wallet_core_ready", { merchantId })
    }

    return NextResponse.json({ profile, merchantId, providerSync, setupStatus })
  } catch (error) {
    console.warn("[pinetree-wallets] wallet_profile_post_error", {
      error: error instanceof Error ? error.message : String(error),
    })
    console.warn("[pinetree-wallets] profile_route_upsert_failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: "Failed to save wallet profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

/**
 * GET /api/wallets/pinetree-profile
 * Returns the current merchant's PineTree Wallet profile, or { profile: null } if none exists.
 * Lightning readiness is loaded independently and never blocks this profile read.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireMerchantAuthFromRequest(req)
    const resolved = await resolveProfileMerchant(auth)
    const { merchantId } = resolved
    if (!merchantId) {
      console.warn("[pinetree-wallets] wallet_profile_get_auth_failed", {
        ...walletProfileAuthDiagnostics({
          authUserPresent: Boolean(resolved.authUserId),
          canonicalMerchantResolved: resolved.canonicalMerchantResolved,
          fallbackMerchantResolved: resolved.fallbackMerchantResolved,
          merchantOwnershipConfirmed: false,
          status: 403,
        }),
      })
      return NextResponse.json({ error: "merchant_not_resolved" }, { status: 403 })
    }
    console.info("[pinetree-wallets] wallet_profile_get_start", { merchantId })
    const profile = await getPineTreeWalletProfile(merchantId)
    console.info(
      profile ? "[pinetree-wallets] wallet_profile_get_success" : "[pinetree-wallets] wallet_profile_get_missing",
      { merchantId, status: profile?.status ?? null }
    )
    return NextResponse.json({
      profile,
      status: profile ? profile.status : "not_created",
    })
  } catch (error) {
    const status = getRouteErrorStatus(error)
    console.warn("[pinetree-wallets] wallet_profile_get_auth_failed", {
      ...walletProfileAuthDiagnostics({
        authUserPresent: false,
        canonicalMerchantResolved: false,
        fallbackMerchantResolved: false,
        merchantOwnershipConfirmed: false,
        status,
      }),
    })
    console.warn("[pinetree-wallets] wallet_profile_get_error", {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: "Failed to load wallet profile" },
      { status }
    )
  }
}
