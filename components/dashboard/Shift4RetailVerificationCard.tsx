"use client"

/**
 * Shift4 Retail connection verification — internal operator interface.
 *
 * One explicit, read-only check that the Retail credential PineTree already
 * stores still authenticates. It sends no card data, creates no transaction,
 * performs no Access Token Exchange, and changes no stored credential.
 *
 * ── Interaction discipline ───────────────────────────────────────────────────
 * The verification runs ONLY on an explicit click. There is no effect that
 * fires it on mount, no polling, and no automatic retry: a repeat is always a
 * second deliberate click. A ref blocks a double submission synchronously,
 * before React can re-render with `submitting` set.
 *
 * ── Disclosure ───────────────────────────────────────────────────────────────
 * The card renders only the safe fields the route returns. No token,
 * fingerprint of a secret, provider body, header, or database detail is
 * reachable from this component.
 */

import { useCallback, useRef, useState } from "react"

import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import {
  canSubmitRetailVerification,
  submitRetailVerification,
  type RetailVerificationFailure,
  type RetailVerificationResult,
} from "@/lib/shift4/retailVerification"
import { supabase } from "@/lib/supabaseClient"

async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export default function Shift4RetailVerificationCard() {
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<RetailVerificationResult | null>(null)
  const [failure, setFailure] = useState<RetailVerificationFailure | null>(null)

  // A ref, not state: it blocks a second submit synchronously, before React has
  // any chance to re-render with `submitting` set.
  const inFlightRef = useRef(false)

  const verify = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setSubmitting(true)
    setResult(null)
    setFailure(null)

    try {
      // Exactly one dispatch. No retry loop exists on any path.
      const outcome = await submitRetailVerification({
        getBearerToken: currentAccessToken,
      })
      if (outcome.status === "success") setResult(outcome.result)
      else setFailure(outcome.failure)
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }, [])

  const canSubmit = canSubmitRetailVerification({ submitting })

  return (
    <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
          Read-only check
        </p>
        <h3 className="mt-1 text-sm font-semibold text-gray-950">
          Shift4 Retail connection
        </h3>
        <p className="mt-1 text-xs text-gray-600">
          Sends one read-only Merchant Information request using the Retail credential already
          stored for this account. It does not exchange a new token, replace the stored
          credential, send a payment, or enable card processing.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void verify()}
        disabled={!canSubmit}
        aria-busy={submitting}
        className={`${primaryActionButtonClass} mt-3 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {submitting ? "Verifying…" : "Verify Shift4 Retail Connection"}
      </button>

      {/* ── Success ─────────────────────────────────────────────────────── */}
      {result ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
          <p className="text-sm font-semibold text-emerald-900">
            Stored Retail authentication is usable
          </p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {[
              ["Connection ID", result.connectionId],
              ["Environment", result.environment],
              ["Channel", result.channel],
              ["Credential source", result.credentialSource],
              ["Operation", result.operation],
              ["Shift4 server", result.serverName ?? "Not returned"],
              ["Shift4 date/time", result.providerDateTime ?? "Not returned"],
              ["Verified at", formatTimestamp(result.verifiedAt)],
              ["Correlation ID", result.correlationId],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap gap-1 text-xs">
                <dt className="font-semibold text-emerald-900">{label}:</dt>
                <dd className="break-all font-mono text-emerald-800">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-emerald-900">
            This proves only that the stored Retail credential authenticates right now. It is not
            certification, terminal readiness, card-processing approval, or production
            eligibility.
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            Retail processing is currently{" "}
            <span className="font-semibold">
              {result.capabilities.retailProcessingEnabled ? "enabled" : "disabled"}
            </span>
            . This check does not change it.
          </p>
        </div>
      ) : null}

      {/* ── Failure ─────────────────────────────────────────────────────── */}
      {failure ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-sm font-semibold text-amber-900">Verification did not succeed</p>
          <p className="mt-1 text-xs text-amber-900">{failure.message}</p>
          {failure.correlationId ? (
            <p className="mt-1 break-all font-mono text-xs text-amber-800">
              Correlation ID: {failure.correlationId}
            </p>
          ) : null}
          <p className="mt-2 text-xs font-medium text-amber-900">
            {failure.reviewRequired
              ? "Stop and review the connection before trying again."
              : "You can try the verification again when ready."}
          </p>
        </div>
      ) : null}
    </section>
  )
}
