import { type NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import {
  getPineTreeWalletProfile,
  inferBtcAddressType,
  normalizeBtcAddressType,
  upsertPineTreeWalletProfile
} from "@/database/pineTreeWalletProfiles"
import { provisionMerchantBitcoinAddress } from "@/engine/pineTreeBitcoinAddressProvisioning"

/**
 * GET /api/wallets/pinetree-profile
 * Returns the current merchant's PineTree Wallet profile, or { profile: null } if none exists.
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const profile = await getPineTreeWalletProfile(merchantId)
    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load wallet profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
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
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as Record<string, unknown>
    if (body.action === "reset_dynamic_wallet_profile") {
      const profile = await upsertPineTreeWalletProfile({
        merchantId,
        dynamicUserId: null,
        baseAddress: null,
        solanaAddress: null,
        bitcoinLightningAddress: null,
        bitcoinOnchainAddress: null,
      })
      return NextResponse.json({ profile })
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

    const profile = await upsertPineTreeWalletProfile({
      merchantId,
      dynamicUserId: "dynamic_user_id" in body ? (body.dynamic_user_id as string | null) : undefined,
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

    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save wallet profile" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
