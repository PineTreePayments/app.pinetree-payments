import { StripeClient, type StripeRawAccount } from "./client"
import type {
  StripeConnectedAccount,
  StripeConnectedAccountDetails
} from "./types"

/**
 * Stripe Connect connected-account operations.
 *
 * Account model: platform-controlled account per the current Stripe Connect
 * controller configuration (validated against the installed stripe@22 SDK
 * types — see StripeAccountCreateBody in ./client):
 *
 *  - controller.stripe_dashboard.type = "none"
 *      The merchant never gets a Stripe-hosted dashboard; onboarding and
 *      management stay inside the PineTree Providers experience.
 *  - controller.requirement_collection = "application"
 *      PineTree is responsible for requirement collection, fulfilled through
 *      Stripe's embedded onboarding component inside PineTree. (Stripe
 *      requires this whenever the platform owns losses and the account has
 *      no Stripe dashboard — verified against the live Stripe API, which
 *      rejects requirement_collection=stripe for this configuration.)
 *  - controller.fees.payer = "application" and
 *    controller.losses.payments = "application"
 *      PineTree (the platform) is responsible for Stripe fees and negative
 *      balances. This configuration supports both direct and destination
 *      charges — the charge model is intentionally NOT fixed in this phase.
 *
 * Capabilities requested: card_payments + transfers only (the minimum for
 * card acceptance with either future charge model). Terminal capabilities
 * are out of scope for this phase.
 */

function normalizeConnectedAccount(account: StripeRawAccount & { id: string }): StripeConnectedAccount {
  return {
    id: account.id,
    detailsSubmitted: Boolean(account.details_submitted),
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled)
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

export function normalizeConnectedAccountDetails(
  account: StripeRawAccount & { id: string }
): StripeConnectedAccountDetails {
  const requirements = account.requirements || {}
  const capabilities: Record<string, string> = {}
  for (const [name, state] of Object.entries(account.capabilities || {})) {
    capabilities[name] = String(state)
  }

  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(account.metadata || {})) {
    metadata[key] = String(value)
  }

  return {
    ...normalizeConnectedAccount(account),
    requirements: {
      currentlyDue: normalizeStringArray(requirements.currently_due),
      eventuallyDue: normalizeStringArray(requirements.eventually_due),
      pastDue: normalizeStringArray(requirements.past_due),
      pendingVerification: normalizeStringArray(requirements.pending_verification),
      disabledReason: requirements.disabled_reason ? String(requirements.disabled_reason) : null
    },
    capabilities,
    metadata
  }
}

/** Metadata key that binds a connected account to a PineTree merchant. */
export const STRIPE_MERCHANT_METADATA_KEY = "pinetree_merchant_id"

export async function createStripeConnectedAccount(params?: {
  merchantId?: string
}): Promise<StripeConnectedAccount> {
  const client = new StripeClient()
  const merchantId = String(params?.merchantId || "").trim()

  const account = await client.createConnectedAccount({
    controller: {
      stripe_dashboard: { type: "none" },
      requirement_collection: "application",
      fees: { payer: "application" },
      losses: { payments: "application" }
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    // Safe binding metadata only — never business or personal data.
    ...(merchantId ? { metadata: { [STRIPE_MERCHANT_METADATA_KEY]: merchantId } } : {})
  })

  return normalizeConnectedAccount(account)
}

export async function retrieveStripeConnectedAccount(accountId: string): Promise<StripeConnectedAccount> {
  const client = new StripeClient()
  return normalizeConnectedAccount(await client.retrieveConnectedAccount(accountId))
}

export async function retrieveStripeConnectedAccountDetails(
  accountId: string
): Promise<StripeConnectedAccountDetails> {
  const client = new StripeClient()
  return normalizeConnectedAccountDetails(await client.retrieveConnectedAccount(accountId))
}
