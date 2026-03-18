import { supabase } from "@/lib/database/supabase"

export async function getProviderCredential(
  merchantId: string,
  provider: string
) {

  const { data, error } = await supabase
    .from("merchant_providers")
    .select("api_key, wallet_address")
    .eq("merchant_id", merchantId)
    .eq("provider", provider)
    .eq("enabled", true)
    .single()

  if (error || !data) {
    throw new Error(`Provider credential missing for ${provider}`)
  }

  /* -----------------------------
  RETURN API KEY OR WALLET
  ----------------------------- */

  if (data.api_key) {
    return data.api_key
  }

  if (data.wallet_address) {
    return data.wallet_address
  }

  throw new Error(`Provider credential invalid for ${provider}`)
}