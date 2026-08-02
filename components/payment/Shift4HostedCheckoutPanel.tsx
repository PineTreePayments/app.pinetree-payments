"use client"

export type Shift4CheckoutUiState =
  | "not_configured" | "unavailable" | "preparing" | "ready" | "tokenizing" | "submitting"
  | "processing" | "additional_tender_required" | "referral_required" | "confirmed" | "declined"
  | "expired_session" | "recovery_required" | "technical_error"

const COPY: Record<Shift4CheckoutUiState, string> = {
  not_configured: "Shift4 secure checkout is not configured.", unavailable: "Shift4 secure checkout is unavailable.",
  preparing: "Preparing the secure card form…", ready: "Secure card form is ready.", tokenizing: "Securing card details with Shift4…",
  submitting: "Submitting the payment…", processing: "Payment outcome is being confirmed. Do not submit again.",
  additional_tender_required: "An additional tender is required for the remaining balance.", referral_required: "This payment requires merchant assistance.",
  confirmed: "Payment confirmed.", declined: "The card was declined.", expired_session: "The secure card session expired.",
  recovery_required: "PineTree is checking the invoice before another attempt.", technical_error: "A temporary technical error prevented checkout.",
}

export default function Shift4HostedCheckoutPanel(props: { state: Shift4CheckoutUiState; readinessReason?: string | null; errorMessage?: string | null; onStart?: () => void; onRecoveryLookup?: () => void }) {
  const canStart = props.state === "ready" && Boolean(props.onStart)
  return <section aria-live="polite" aria-label="Shift4 secure checkout" className="rounded-xl border border-gray-200 bg-white p-4">
    <p className="text-sm font-semibold text-gray-950">Secure card checkout</p>
    <p role={props.state === "technical_error" || props.state === "declined" ? "alert" : undefined} className="mt-2 text-sm text-gray-600">{props.errorMessage || props.readinessReason || COPY[props.state]}</p>
    {canStart ? <button type="button" onClick={props.onStart} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Continue securely</button> : null}
    {(props.state === "processing" || props.state === "recovery_required") && props.onRecoveryLookup ? <button type="button" onClick={props.onRecoveryLookup} className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">Check status</button> : null}
  </section>
}
