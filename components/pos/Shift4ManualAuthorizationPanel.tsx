"use client"

import { useState } from "react"

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
 */
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
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const valid = /^[A-Za-z0-9]{6}$/.test(code.trim())

  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch("/api/pos/shift4-manual-authorization", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        },
        // Exactly two fields. No invoice, amount, token, or merchant.
        body: JSON.stringify({ paymentId, authorizationCode: code.trim() }),
        cache: "no-store",
      })
      const payload = (await response.json().catch(() => null)) as
        | { blockedReason?: string; error?: string }
        | null
      if (!response.ok) {
        setError(payload?.error || "The manual authorization could not be submitted.")
        return
      }
      setResult(payload?.blockedReason || "Submitted.")
    } catch {
      setError("The manual authorization could not be submitted.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-left">
      <h3 className="text-sm font-semibold text-amber-900">Voice authorization required</h3>
      <p className="mt-1 text-xs text-amber-900">
        The card issuer will not approve this transaction without a phone call. Call the voice
        authorization centre, then enter the six-character code they provide.
      </p>

      <label className="mt-3 block text-xs font-medium text-amber-900">
        Authorization code
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 6))}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={6}
          placeholder="ABC123"
          className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-sm tracking-widest text-gray-950"
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
          onClick={onCancel}
          className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900"
        >
          Cancel
        </button>
      </div>

      {result ? <p className="mt-3 text-xs text-amber-900">Retail processing is blocked: {result.toLowerCase()}.</p> : null}
      {error ? <p className="mt-3 text-xs font-semibold text-red-700">{error}</p> : null}
    </section>
  )
}
