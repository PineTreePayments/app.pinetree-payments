import { supabase, supabaseAdmin } from "@/database"
import { startStripeConnectOnboarding } from "./stripeConnect"
import { assertMerchantBusinessProfileComplete } from "./businessProfile"

const db = supabaseAdmin || supabase

export type CardSetupProvider = "stripe" | "fluidpay"
export type CardSetupStatus = "not_started" | "pending" | "approved" | "denied"

type JsonObject = { [key: string]: unknown }

const PROVIDER_SETUP: Record<CardSetupProvider, {
  applicationUrlEnv: string[]
  providerModel: string
}> = {
  stripe: {
    applicationUrlEnv: ["STRIPE_APPLICATION_URL", "NEXT_PUBLIC_STRIPE_APPLICATION_URL"],
    providerModel: "stripe_managed_onboarding"
  },
  fluidpay: {
    applicationUrlEnv: ["FLUIDPAY_APPLICATION_URL", "NEXT_PUBLIC_FLUIDPAY_APPLICATION_URL"],
    providerModel: "fluidpay_managed_onboarding"
  }
}

export function isCardSetupProvider(provider: string): provider is CardSetupProvider {
  return provider === "stripe" || provider === "fluidpay"
}

export function getCardSetupApplicationUrl(provider: CardSetupProvider): string {
  const envNames = PROVIDER_SETUP[provider].applicationUrlEnv
  for (const envName of envNames) {
    const value = String(process.env[envName] || "").trim()
    if (value) return value
  }
  return ""
}

export function buildCardSetupRedirectUrl(provider: CardSetupProvider, returnUrl: string): string {
  const configuredUrl = getCardSetupApplicationUrl(provider)
  if (!configuredUrl) return ""

  const url = new URL(configuredUrl)
  url.searchParams.set("return_url", returnUrl)
  return url.toString()
}

async function getExistingProviderCredentials(merchantId: string, provider: CardSetupProvider): Promise<JsonObject> {
  const { data, error } = await db
    .from("merchant_providers")
    .select("credentials")
    .eq("merchant_id", merchantId)
    .eq("provider", provider)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed loading ${provider} setup: ${error.message}`)
  }

  return (data?.credentials || {}) as JsonObject
}

async function upsertCardProviderSetup(
  merchantId: string,
  provider: CardSetupProvider,
  credentials: JsonObject
): Promise<void> {
  const { error } = await db
    .from("merchant_providers")
    .upsert(
      {
        merchant_id: merchantId,
        provider,
        status: "pending",
        enabled: false,
        credentials,
        updated_at: new Date().toISOString()
      },
      { onConflict: "merchant_id,provider" }
    )

  if (error) {
    throw new Error(`Failed saving ${provider} setup: ${error.message}`)
  }
}

export async function startCardProviderSetup(args: {
  merchantId: string
  provider: CardSetupProvider
  returnUrl: string
}): Promise<{ ok: true; url: string; applicationStatus: "pending" } | { ok: false; error: string }> {
  await assertMerchantBusinessProfileComplete(args.merchantId)

  if (args.provider === "stripe") {
    return startStripeConnectOnboarding({ merchantId: args.merchantId })
  }

  const redirectUrl = buildCardSetupRedirectUrl(args.provider, args.returnUrl)
  if (!redirectUrl) {
    return { ok: false, error: "Setup link not configured yet." }
  }

  const now = new Date().toISOString()
  const existingCredentials = await getExistingProviderCredentials(args.merchantId, args.provider)
  const credentials: JsonObject = {
    ...existingCredentials,
    provider_model: PROVIDER_SETUP[args.provider].providerModel,
    application_status: "pending",
    setup_started_at: existingCredentials.setup_started_at || now,
    setup_submitted_at: now
  }

  await upsertCardProviderSetup(args.merchantId, args.provider, credentials)

  return { ok: true, url: redirectUrl, applicationStatus: "pending" }
}

export async function markCardProviderSetupReturned(args: {
  merchantId: string
  provider: CardSetupProvider
}): Promise<{ ok: true; applicationStatus: "pending" }> {
  const now = new Date().toISOString()
  const existingCredentials = await getExistingProviderCredentials(args.merchantId, args.provider)
  const credentials: JsonObject = {
    ...existingCredentials,
    provider_model: PROVIDER_SETUP[args.provider].providerModel,
    application_status: "pending",
    setup_started_at: existingCredentials.setup_started_at || now,
    setup_submitted_at: existingCredentials.setup_submitted_at || now,
    setup_returned_at: now
  }

  await upsertCardProviderSetup(args.merchantId, args.provider, credentials)

  return { ok: true, applicationStatus: "pending" }
}
