"use client"

import { useState } from "react"
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js/pure"
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js"

/**
 * Stripe Connect embedded onboarding, rendered inside the PineTree Providers
 * experience — the merchant never leaves PineTree and is never redirected to
 * a Stripe-hosted page.
 *
 * Display-only: the Account Session client secret is fetched through the
 * authenticated PineTree API (`fetchClientSecret` prop) and handed straight
 * to Stripe's Connect JS. It is never stored, logged, or rendered. Only the
 * publishable key is used client-side.
 */

type StripeConnectOnboardingProps = {
  /** Fetches a fresh Account Session client secret from the PineTree API. */
  fetchClientSecret: () => Promise<string>
  /** Called when the merchant exits or completes the onboarding flow. */
  onExit: () => void
}

export default function StripeConnectOnboarding({
  fetchClientSecret,
  onExit
}: StripeConnectOnboardingProps) {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
  const [setupError, setSetupError] = useState("")

  // Initialize exactly once per mount; Connect JS calls fetchClientSecret
  // itself whenever it needs a session.
  const [connectInstance] = useState<StripeConnectInstance | null>(() => {
    if (!publishableKey) return null

    return loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: async () => {
        try {
          const clientSecret = await fetchClientSecret()
          setSetupError("")
          return clientSecret
        } catch (error) {
          setSetupError(
            error instanceof Error ? error.message : "Unable to start Stripe onboarding right now."
          )
          throw error
        }
      }
    })
  })

  if (!publishableKey || !connectInstance) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
        Stripe onboarding is not configured yet. Please contact PineTree support.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {setupError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {setupError}
        </div>
      ) : null}
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding onExit={onExit} />
      </ConnectComponentsProvider>
    </div>
  )
}
