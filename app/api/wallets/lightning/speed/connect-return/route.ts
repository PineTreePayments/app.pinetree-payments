/**
 * /api/wallets/lightning/speed/connect-return
 *
 * Optional Speed Connect return target. Speed redirects here after an account
 * accepts a Connect invite when SPEED_CONNECT_RETURN_URL is configured.
 * No Speed secrets are accepted or returned.
 */

import { type NextRequest, NextResponse } from "next/server"
import { getMerchantLightningProfile, upsertMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { getPineTreeWalletProfile, upsertPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import {
  getSpeedConnectedAccountSetupStatus,
  type SpeedConnectedAccountReadiness,
} from "@/providers/lightning/speedConnectedAccounts"

function mapSpeedReadinessToLightningStatus(readiness: SpeedConnectedAccountReadiness) {
  if (readiness === "ready") return "ready" as const
  if (readiness === "needs_attention") return "needs_attention" as const
  return "pending" as const
}

function redirectToWalletSetup(req: NextRequest) {
  return NextResponse.redirect(new URL("/dashboard/wallet-setup", req.url))
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams
  const merchantId = String(search.get("merchant_id") || "").trim()
  const connectedAccountId = String(
    search.get("connected_account_id") ||
      search.get("connect_id") ||
      search.get("id") ||
      search.get("ca_id") ||
      ""
  ).trim()
  const accountId = String(search.get("account_id") || "").trim()

  if (!merchantId || (!connectedAccountId && !accountId)) {
    return redirectToWalletSetup(req)
  }

  try {
    const existing = await getMerchantLightningProfile(merchantId)
    if (!existing) return redirectToWalletSetup(req)

    const speedSetup = await getSpeedConnectedAccountSetupStatus({
      connectedAccountId,
      accountId,
    })
    const status = mapSpeedReadinessToLightningStatus(speedSetup.readiness)
    const lightningProfile = await upsertMerchantLightningProfile({
      merchantId,
      status,
      speedConnectedAccountId: speedSetup.speed_connected_account_id,
      speedConnectedAccountStatus: speedSetup.speed_connected_account_status,
      speedConnectSetupUrl: speedSetup.setup_url,
      providerResponseSummary: speedSetup.provider_response_summary,
      providerErrorMessage: speedSetup.error_message,
    })

    const walletProfile = await getPineTreeWalletProfile(merchantId)
    if (walletProfile) {
      await upsertPineTreeWalletProfile({
        merchantId,
        bitcoinLightningStatus: lightningProfile.status,
        bitcoinLightningProvider: "speed",
        bitcoinLightningAccountId: lightningProfile.speed_connected_account_id,
        bitcoinLightningReceiveMode: "invoice",
      })
    }
  } catch {
    // Keep the browser return path resilient. The merchant-facing dashboard can
    // retry PineTree-managed Lightning setup without exposing provider errors.
  }

  return redirectToWalletSetup(req)
}
