"use client"

import { useRef, useState } from "react"

/**
 * The clerk's voice-authorization step.
 *
 * Rendered ONLY after PineTree has a real referral outcome — it never appears on
 * an ordinary approval, and it never runs itself. Shift4's guidance is explicit
 * that manual authorization follows a phone call the clerk makes, so submitting
 * is always a deliberate action taken after the issuer reads the code out.
 *
 * The panel sends exactly two values: the PineTree payment reference it was
 * given, and the six characters typed here. It never sees or sends the invoice,
 * amount, card token, access token, device serial, or merchant id — all of
 * those are derived server-side from the persisted referral attempt.
 *
 * The typed code is deliberately short-lived in browser state: it is cleared as
 * soon as the submission succeeds or the clerk cancels, and it is never written
 * to the console, an analytics call, or an error message.
 */

type Outcome =
  | { kind: "blocked"; reason: string }
  | { kind: "accepted" }
  | { kind: "error"; message: string; correlationId?: string }

export default function Shift4ManualAuthorizationPanel({
  paymentId,
  sessionToken,
  onCancel,
}: {
  paymentId: string
  sessionToken?: string
  onCancel?: () => void
}) {
  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // React state updates are asynchronous, so `submitting` alone cannot stop two
  // clicks landing in the same tick. This ref flips synchronously on entry, so
  // one click is one request no matter how fast the second arrives.
  const inFlightRef = useRef(false)

  const valid = /^[A-Z0-9]{6}$/.test(code)

  const submit = async () => {
    if (inFlightRef.current) return
    if (!valid) return
    inFlightRef.current = true
    setSubmitting(true)
    setOutcome(null)
    try {
      const response = await fetch("/api/pos/shift4-manual-authorization", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        },
        // Exactly two fields. No invoice, amount, token, or merchant.
        body: JSON.stringify({ paymentId, authorizationCode: code }),
        cache: "no-store",
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            dispatchPermitted?: boolean
            blockedReason?: string
            error?: string
            correlationId?: string
          }
        | null

      if (!response.ok) {
        // Generic, and never carries the code or a raw provider/database error.
        setOutcome({
          kind: "error",
          message: payload?.error || "The manual authorization could not be submitted.",
          correlationId: payload?.correlationId,
        })
        return
      }

      // The code left the browser successfully, so it is discarded here whether
      // the server dispatched it or reported a closed gate.
      setCode("")
      setOutcome(
        payload?.dispatchPermitted === false && payload?.blockedReason
          ? { kind: "blocked", reason: payload.blockedReason }
          : { kind: "accepted" }
      )
    } catch {
      setOutcome({
        kind: "error",
        message: "The manual authorization could not be submitted.",
      })
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }

  // Explicit clerk action. Sends nothing to Shift4 and leaves the payment
  // unresolved so it stays available for reconciliation.
  const cancel = () => {
    if (submitting) return
    setCode("")
    setOutcome(null)
    onCancel?.()
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-left">
      <h3 className="text-sm font-semibold text-amber-900">Voice authorization required</h3>
      <p className="mt-1 text-xs text-amber-900">
        The card issuer will not approve this transaction without a phone call. Call the
        authorization center and enter the six-character approval code.
      </p>

      <label className="mt-3 block text-xs font-medium text-amber-900">
        Authorization code
        <input
          value={code}
          // Spaces and punctuation are dropped as they are typed, and letters
          // are uppercased, so the field can only ever hold the six characters
          // the server will accept.
          onChange={(event) =>
            setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
          }
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={6}
          disabled={submitting}
          placeholder="ABC123"
          aria-label="Authorization code"
          className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-sm tracking-widest text-gray-950 disabled:opacity-60"
        />
      </label>

      <p className="mt-2 text-xs font-semibold text-red-700">
        Enter only the code the issuer gave you. Entering an incorrect or invented code can result
        in a chargeback and financial loss for this merchant.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || submitting}
          aria-busy={submitting}
          className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit Manual Authorization"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={submitting}
          className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {submitting ? (
        <p className="mt-3 text-xs text-amber-900" role="status">
          Submitting the manual authorization. Keep this sale open until it finishes.
        </p>
      ) : null}

      {outcome?.kind === "accepted" ? (
        <p className="mt-3 text-xs font-semibold text-amber-900" role="status">
          The authorization code was accepted. This sale now continues through its normal
          processing.
        </p>
      ) : null}

      {outcome?.kind === "blocked" ? (
        <p className="mt-3 text-xs text-amber-900" role="status">
          The authorization code was accepted, but Shift4 Retail processing is not enabled yet:{" "}
          {outcome.reason.toLowerCase()}. This sale stays open for reconciliation.
        </p>
      ) : null}

      {outcome?.kind === "error" ? (
        <p className="mt-3 text-xs font-semibold text-red-700" role="alert">
          {outcome.message}
          {outcome.correlationId ? ` Reference: ${outcome.correlationId}.` : ""}
        </p>
      ) : null}
    </section>
  )
}
