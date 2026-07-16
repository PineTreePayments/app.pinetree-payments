import { StripeClient } from "./client"

/**
 * Stripe Connect onboarding sessions.
 *
 * Embedded onboarding (canonical): createStripeAccountSession creates an
 * Account Session enabling only the account_onboarding embedded component.
 * The client secret is short-lived, is returned only to the authenticated
 * merchant's browser session, and must never be persisted or logged.
 *
 * Hosted account links (legacy fallback): createStripeOnboardingLink remains
 * for the pre-embedded redirect flow (return_url / refresh_url pages).
 */

export async function createStripeAccountSession(params: {
  accountId: string
}): Promise<{ clientSecret: string }> {
  const client = new StripeClient()
  const session = await client.createAccountSession({
    account: params.accountId,
    components: {
      account_onboarding: { enabled: true }
    }
  })
  return { clientSecret: session.client_secret }
}

export async function createStripeOnboardingLink(params: {
  accountId: string
  returnUrl: string
  refreshUrl: string
}): Promise<{ url: string }> {
  const client = new StripeClient()
  return client.createAccountLink({
    account: params.accountId,
    return_url: params.returnUrl,
    refresh_url: params.refreshUrl,
    type: "account_onboarding"
  })
}
