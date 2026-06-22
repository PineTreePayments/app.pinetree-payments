import { supabase, supabaseAdmin } from "@/database"
import { StripeClient } from "@/lib/providers/stripe/client"

const db = supabaseAdmin || supabase

type StripeConnectCredentials = {
  stripe_account_id?: string
  details_submitted?: boolean
  charges_enabled?: boolean
  payouts_enabled?: boolean
  connect_last_synced_at?: string
  connect_onboarding_started_at?: string
}

export function getStripeConnectStatus(credentials?: StripeConnectCredentials | null): {
  status: "not_started" | "pending" | "active"
  enabled: boolean
} {
  if (!String(credentials?.stripe_account_id || "").trim()) {
    return { status: "not_started", enabled: false }
  }
  if (credentials?.charges_enabled === true) return { status: "active", enabled: true }
  return { status: "pending", enabled: false }
}

function sanitizeConnectCredentials(credentials: StripeConnectCredentials): StripeConnectCredentials {
  return {
    ...(credentials.stripe_account_id ? { stripe_account_id: credentials.stripe_account_id } : {}),
    ...(credentials.details_submitted !== undefined ? { details_submitted: credentials.details_submitted } : {}),
    ...(credentials.charges_enabled !== undefined ? { charges_enabled: credentials.charges_enabled } : {}),
    ...(credentials.payouts_enabled !== undefined ? { payouts_enabled: credentials.payouts_enabled } : {}),
    ...(credentials.connect_onboarding_started_at ? { connect_onboarding_started_at: credentials.connect_onboarding_started_at } : {}),
    ...(credentials.connect_last_synced_at ? { connect_last_synced_at: credentials.connect_last_synced_at } : {})
  }
}

async function getConnectCredentials(merchantId: string): Promise<StripeConnectCredentials> {
  const { data, error } = await db
    .from("merchant_providers")
    .select("credentials")
    .eq("merchant_id", merchantId)
    .eq("provider", "stripe")
    .maybeSingle()

  if (error) throw new Error(`Failed loading Stripe Connect setup: ${error.message}`)
  return (data?.credentials || {}) as StripeConnectCredentials
}

async function upsertConnectSetup(
  merchantId: string,
  credentials: StripeConnectCredentials,
  status: string,
  enabled: boolean
): Promise<void> {
  const { error } = await db
    .from("merchant_providers")
    .upsert(
      {
        merchant_id: merchantId,
        provider: "stripe",
        status,
        enabled,
        credentials: sanitizeConnectCredentials(credentials),
        updated_at: new Date().toISOString()
      },
      { onConflict: "merchant_id,provider" }
    )

  if (error) throw new Error(`Failed saving Stripe Connect setup: ${error.message}`)
}

export async function startStripeConnectOnboarding(args: {
  merchantId: string
}): Promise<{ ok: true; url: string; applicationStatus: "pending" } | { ok: false; error: string }> {
  const returnUrl = String(process.env.NEXT_PUBLIC_STRIPE_CONNECT_RETURN_URL || "").trim()
  const refreshUrl = String(process.env.NEXT_PUBLIC_STRIPE_CONNECT_REFRESH_URL || "").trim()

  if (!returnUrl || !refreshUrl) {
    return { ok: false, error: "Stripe Connect is not configured yet." }
  }

  const existing = await getConnectCredentials(args.merchantId)
  let stripeAccountId = String(existing.stripe_account_id || "").trim()

  const client = new StripeClient()

  if (!stripeAccountId) {
    const account = await client.createConnectedAccount({ type: "express" })
    stripeAccountId = account.id
  }

  const link = await client.createAccountLink({
    account: stripeAccountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: "account_onboarding"
  })

  const now = new Date().toISOString()
  const credentials: StripeConnectCredentials = {
    ...existing,
    stripe_account_id: stripeAccountId,
    connect_onboarding_started_at: existing.connect_onboarding_started_at || now
  }

  await upsertConnectSetup(args.merchantId, credentials, "pending", false)

  return { ok: true, url: link.url, applicationStatus: "pending" }
}

export async function syncStripeConnectAccount(args: {
  merchantId: string
}): Promise<
  | { ok: true; status: string; enabled: boolean; details_submitted: boolean; charges_enabled: boolean; payouts_enabled: boolean }
  | { ok: false; error: string }
> {
  const existing = await getConnectCredentials(args.merchantId)
  const stripeAccountId = String(existing.stripe_account_id || "").trim()

  if (!stripeAccountId) {
    return { ok: false, error: "No Stripe connected account found for this merchant." }
  }

  const client = new StripeClient()
  const account = await client.retrieveConnectedAccount(stripeAccountId)

  const { status, enabled } = getStripeConnectStatus({
    stripe_account_id: stripeAccountId,
    details_submitted: account.details_submitted,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled
  })

  const credentials: StripeConnectCredentials = {
    ...existing,
    stripe_account_id: stripeAccountId,
    details_submitted: account.details_submitted,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    connect_last_synced_at: new Date().toISOString()
  }

  await upsertConnectSetup(args.merchantId, credentials, status, enabled)

  return {
    ok: true,
    status,
    enabled,
    details_submitted: account.details_submitted,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled
  }
}

export async function getMerchantStripeAccountId(merchantId: string): Promise<string | undefined> {
  const credentials = await getConnectCredentials(merchantId)
  return String(credentials.stripe_account_id || "").trim() || undefined
}
