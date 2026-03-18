import { supabase } from "@/lib/database/supabase"
import { isProviderHealthy } from "./providerHealth"
import { PaymentProvider } from "@/types/payment"

export async function chooseBestProvider(
  merchantId: string
): Promise<PaymentProvider> {

  /* ---------------------------
  LOAD MERCHANT PROVIDERS
  --------------------------- */

  const { data, error } = await supabase
    .from("merchant_providers")
    .select("provider,status")
    .eq("merchant_id", merchantId)
    .eq("status", "connected")

  if (error || !data || data.length === 0) {
    throw new Error("No payment providers connected")
  }

  const providers = data.map(p => p.provider as PaymentProvider)

  /* ---------------------------
  HEALTH CHECK ROUTING
  --------------------------- */

  for (const provider of providers) {

    const healthy = await isProviderHealthy(provider)

    if (healthy) {
      return provider
    }

  }

  throw new Error("No healthy payment providers available")
}