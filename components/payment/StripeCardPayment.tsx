"use client"

import { useState, useCallback } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js"
import Button from "@/components/ui/Button"

// Singleton promise — created once per page load, never re-created.
const stripePromise = typeof window !== "undefined" && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null

type StripePaymentFormProps = {
  onSuccess: () => void
  onError: (message: string) => void
}

function StripePaymentForm({ onSuccess, onError }: StripePaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  const handlePay = useCallback(async () => {
    if (!stripe || !elements) return
    setSubmitting(true)
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
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
  }, [stripe, elements, onSuccess, onError])

  return (
    <div className="space-y-4">
      <PaymentElement />
      <Button fullWidth disabled={submitting || !stripe || !elements} onClick={() => void handlePay()}>
        {submitting ? (
          <>
            <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
            Processing…
          </>
        ) : "Pay Now"}
      </Button>
    </div>
  )
}

type StripeCardPaymentProps = {
  clientSecret: string
  onSuccess: () => void
  onError: (message: string) => void
}

export function StripeCardPayment({ clientSecret, onSuccess, onError }: StripeCardPaymentProps) {
  if (!stripePromise || !clientSecret) return null

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <StripePaymentForm onSuccess={onSuccess} onError={onError} />
    </Elements>
  )
}
