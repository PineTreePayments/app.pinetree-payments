import { supabase, supabaseAdmin } from "./supabase"

const db = supabaseAdmin || supabase

export type MerchantLightningSetup = {
  speedAccountId: string
  lightningAddress: string
  paymentAddressId?: string
  accountSource: "db_credentials"
}

/**
 * Returns the merchant's Speed/Lightning provider setup from merchant_providers.
 * Returns null if no connected/active Lightning provider row exists, or if the
 * row lacks the required Speed merchant account credentials.
 */
export async function getMerchantLightningSetup(
  merchantId: string
): Promise<MerchantLightningSetup | null> {
  const { data } = await db
    .from("merchant_providers")
    .select("credentials")
    .eq("merchant_id", merchantId)
    .eq("provider", "lightning")
    .in("status", ["connected", "active"])
    .maybeSingle()

  if (!data?.credentials) return null

  const creds = data.credentials as Record<string, unknown>
  const speedAccountId = String(creds.speed_account_id || "").trim()
  const lightningAddress = String(creds.lightning_address || "").trim()
  const paymentAddressId = String(creds.payment_address_id || "").trim()
  const providerModel = String(creds.provider_model || "").trim()

  if (providerModel !== "speed_merchant_account") return null
  if (!speedAccountId || !lightningAddress) return null

  return {
    speedAccountId,
    lightningAddress,
    paymentAddressId: paymentAddressId || undefined,
    accountSource: "db_credentials",
  }
}
