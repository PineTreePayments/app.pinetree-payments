import { after, type NextRequest, NextResponse } from "next/server"
import { requireMerchantAuthFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import {
  getPineTreeWalletProfile,
  inferBtcAddressType,
  normalizeBtcAddressType,
  upsertPineTreeWalletProfile
} from "@/database/pineTreeWalletProfiles"
import { backfillMerchantEmailIfMissing, getMerchantById } from "@/database/merchants"
import { syncPineTreeWalletProfileProviders } from "@/database/pineTreeWalletProfileProviderSync"
import { provisionMerchantBitcoinAddress } from "@/engine/pineTreeBitcoinAddressProvisioning"
import { ensureManagedLightningForMerchant } from "@/engine/pineTreeWalletReadiness"
import { assertMerchantBusinessProfileComplete } from "@/engine/businessProfile"
import { withOperationTimeout } from "@/engine/promiseTimeout"
import { resolveWalletIdentity } from "@/lib/walletIdentity"

const BACKGROUND_PROVISIONING_TIMEOUT_MS = 12_000

function profileHasReadyCoreIdentity(profile: Awaited<ReturnType<typeof getPineTreeWalletProfile>>) {
  return Boolean(
    profile &&
    profile.status === "ready" &&
    profile.base_address &&
    profile.solana_address
  )
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

    const lightningStartedAt = Date.now()
    console.info("[pinetree-wallets] background_step", {
      merchant_id: profile.merchant_id,
      step: "lightning_ensure_start",
    })
    console.info("[pinetree-wallets] wallet_lightning_background_started", { merchantId: profile.merchant_id })
    try {
      const lightningResult = await withOperationTimeout(
        ensureManagedLightningForMerchant(profile.merchant_id),
        BACKGROUND_PROVISIONING_TIMEOUT_MS,
        "managed lightning provisioning"
      )
      if (lightningResult.status === "needs_attention") {
        console.info("[pinetree-wallets] wallet_lightning_needs_attention", { merchantId: profile.merchant_id })
      } else if (lightningResult.status === "pending") {
        console.info("[pinetree-wallets] wallet_lightning_pending", { merchantId: profile.merchant_id })
      }
    } catch (error) {
      console.warn("[pinetree-wallets] background_lightning_provisioning_failed", {
        merchantId: profile.merchant_id,
        error: error instanceof Error ? error.message : String(error),
      })
      console.info("[pinetree-wallets] wallet_lightning_needs_attention", { merchantId: profile.merchant_id })
    } finally {
      console.info("[pinetree-wallets] background_timing", {
        merchant_id: profile.merchant_id,
        step: "lightning_ensure_complete",
        duration_ms: Date.now() - lightningStartedAt,
      })
    }
  })
}

/**
 * POST /api/wallets/pinetree-profile
 * Creates or updates the PineTree Wallet profile for the authenticated merchant.
 * Only the addresses/dynamic_user_id provided in the body are written; omitted fields keep their value.
 *
 * Body (all optional):
 *   dynamic_user_id        string | null
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
    const merchantId = auth.merchantId
    const body = (await req.json()) as Record<string, unknown>
    console.info("[pinetree-wallets] wallet_profile_post_start", { merchantId })
    console.info("[pinetree-wallets] profile_route_post_received", {
      merchantId,
      dynamicUserIdPresent: Boolean(body.dynamic_user_id),
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

    await assertMerchantBusinessProfileComplete(merchantId)

    const syncsDynamicProfile =
      "dynamic_user_id" in body ||
      "dynamic_email" in body ||
      "base_address" in body ||
      "solana_address" in body
    if (syncsDynamicProfile) {
      const merchant = await getMerchantById(merchantId)
      const identity = resolveWalletIdentity({
        merchantEmail: merchant?.email,
        authEmail: auth.email,
        bodyMerchantEmail: body.merchant_email,
        dynamicEmail: body.dynamic_email,
      })
      if (!identity.ok) {
        console.warn("[pinetree-wallets] profile_route_identity_mismatch", {
          merchantId,
          merchantEmailPresent: Boolean(merchant?.email),
          authEmailPresent: Boolean(auth.email),
          reason: identity.code,
        })
        console.warn("[pinetree-wallets] wallet_profile_identity_check_failed", {
          merchantId,
          reason: identity.code,
        })
        return NextResponse.json(
          {
            error: identity.code === "wallet_identity_unavailable"
              ? "wallet_identity_unavailable"
              : "dynamic_email_mismatch",
            message: identity.code === "wallet_identity_unavailable"
              ? "We could not verify your PineTree account identity. Please refresh and try again."
              : "We could not verify wallet access. Please try again.",
            retryable: true,
          },
          { status: 409 }
        )
      }
      if (identity.shouldBackfillMerchantEmail) {
        try {
          const backfilled = await backfillMerchantEmailIfMissing(
            merchantId,
            identity.canonicalEmail,
            merchant?.email
          )
          console.info("[pinetree-wallets] merchant_email_backfilled", {
            merchant_id: merchantId,
            step: backfilled ? "merchant_email_backfilled" : "merchant_email_already_present",
          })
        } catch {
          console.warn("[pinetree-wallets] merchant_email_backfill_deferred", {
            merchant_id: merchantId,
            step: "merchant_email_backfill_deferred",
          })
        }
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
    const existingProfile = await getPineTreeWalletProfile(merchantId)

    if (syncsDynamicProfile) {
      const incomingBaseAddress = "base_address" in body ? (body.base_address as string | null) : undefined
      const incomingSolanaAddress = "solana_address" in body ? (body.solana_address as string | null) : undefined
      const existingReadyProfile = profileHasReadyCoreIdentity(existingProfile)
      const baseConflict = Boolean(
        existingReadyProfile &&
        existingProfile &&
        incomingBaseAddress &&
        existingProfile?.base_address &&
        incomingBaseAddress !== existingProfile.base_address
      )
      const solanaConflict = Boolean(
        existingReadyProfile &&
        incomingSolanaAddress &&
        existingProfile?.solana_address &&
        incomingSolanaAddress !== existingProfile.solana_address
      )
      if (baseConflict || solanaConflict) {
        console.warn("[pinetree-wallets] wallet_profile_post_conflict", {
          merchantId,
          reason: "address_conflict",
          baseConflict,
          solanaConflict,
        })
        console.warn("[pinetree-wallets] wallet_profile_post_conflict_ready_profile_only", {
          merchantId,
          baseConflict,
          solanaConflict,
        })
        return NextResponse.json(
          {
            error: "wallet_address_conflict",
            status: "needs_review",
            message: "This wallet does not match the one already saved for your account. Please contact support before continuing.",
            retryable: false,
          },
          { status: 409 }
        )
      }
      if (
        existingReadyProfile &&
        incomingBaseAddress === existingProfile?.base_address &&
        incomingSolanaAddress === existingProfile?.solana_address
      ) {
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

    const bitcoinProvisioning = hasBtcAddressInput && normalizedBtcAddress
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
      dynamicUserId: "dynamic_user_id" in body ? (body.dynamic_user_id as string | null) : undefined,
      dynamicEmail: "dynamic_email" in body ? (body.dynamic_email as string | null) : undefined,
      baseAddress: "base_address" in body ? (body.base_address as string | null) : undefined,
      solanaAddress: "solana_address" in body ? (body.solana_address as string | null) : undefined,
      bitcoinLightningAddress: "bitcoin_lightning_address" in body ? (body.bitcoin_lightning_address as string | null) : undefined,
      bitcoinOnchainAddress: "bitcoin_onchain_address" in body ? (body.bitcoin_onchain_address as string | null) : undefined,
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
    const merchantId = (await requireMerchantAuthFromRequest(req)).merchantId
    console.info("[pinetree-wallets] wallet_profile_get_start", { merchantId })
    const profile = await getPineTreeWalletProfile(merchantId)
    console.info(
      profile ? "[pinetree-wallets] wallet_profile_get_success" : "[pinetree-wallets] wallet_profile_get_missing",
      { merchantId, status: profile?.status ?? null }
    )
    return NextResponse.json({ profile })
  } catch (error) {
    console.warn("[pinetree-wallets] wallet_profile_get_error", {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: "Failed to load wallet profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
