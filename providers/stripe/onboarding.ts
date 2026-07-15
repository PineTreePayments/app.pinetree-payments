import { StripeClient } from "./client"

export type StripeConnectedAccount = {
  id: string
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
}

function normalizeConnectedAccount(account: {
  id: string
  details_submitted: boolean
  charges_enabled: boolean
  payouts_enabled: boolean
}): StripeConnectedAccount {
  return {
    id: account.id,
    detailsSubmitted: account.details_submitted,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled
  }
}

export async function createStripeConnectedAccount(): Promise<StripeConnectedAccount> {
  const client = new StripeClient()
  return normalizeConnectedAccount(await client.createConnectedAccount({ type: "express" }))
}

export async function retrieveStripeConnectedAccount(accountId: string): Promise<StripeConnectedAccount> {
  const client = new StripeClient()
  return normalizeConnectedAccount(await client.retrieveConnectedAccount(accountId))
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
