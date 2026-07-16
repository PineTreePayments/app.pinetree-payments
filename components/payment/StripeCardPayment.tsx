"use client"

import { useState, useCallback, useMemo } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js"
import Button from "@/components/ui/Button"

// Singleton promise — created once per page load, never re-created.
type StripePaymentFormProps = {
  onSuccess: () => void
  onError: (message: string) => void
  returnUrl?: string
  submitLabel?: string
  showReadyStatus?: boolean
}

function StripePaymentForm({ onSuccess, onError, returnUrl, submitLabel = "Pay Now", showReadyStatus = true }: StripePaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)

  const handlePay = useCallback(async () => {
    if (!stripe || !elements) return
    setSubmitting(true)
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl || window.location.href },
        redirect: "if_required",
      })
      if (error) {
        onError(error.message || "Payment failed. Please try again.")
      } else {
        // confirmPayment resolved without redirect → payment is processing
        onSuccess()
      }
    } catch {
      onError("An unexpected error occurred. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }, [stripe, elements, onSuccess, onError, returnUrl])

  return (
    <div className="space-y-4">
      {showReadyStatus && (
        <p className="text-xs text-gray-500" role="status">
          {ready ? "Payment ready" : "Loading card form"}
        </p>
      )}
      <PaymentElement onReady={() => setReady(true)} />
      <Button fullWidth disabled={submitting || !stripe || !elements} onClick={() => void handlePay()}>
        {submitting ? (
          <>
            <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
            Processing payment…
          </>
        ) : submitLabel}
      </Button>
    </div>
  )
}

type StripeCardPaymentProps = {
  clientSecret: string
  stripeAccountId: string
  onSuccess: () => void
  onError: (message: string) => void
  returnUrl?: string
  submitLabel?: string
  showReadyStatus?: boolean
}

export function StripeCardPayment({ clientSecret, stripeAccountId, onSuccess, onError, returnUrl, submitLabel, showReadyStatus }: StripeCardPaymentProps) {
  const stripePromise = useMemo(() => {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!publishableKey || !stripeAccountId) return null
    return loadStripe(publishableKey, { stripeAccount: stripeAccountId })
  }, [stripeAccountId])

  if (!stripePromise || !clientSecret || !stripeAccountId) return null

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <StripePaymentForm
        onSuccess={onSuccess}
        onError={onError}
        returnUrl={returnUrl}
        submitLabel={submitLabel}
        showReadyStatus={showReadyStatus}
      />
    </Elements>
  )
}
