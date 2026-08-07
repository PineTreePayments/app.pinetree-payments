"use client"

import { useEffect, useState } from "react"

import {
  fetchShift4Readiness,
  type Shift4CapabilityView as CapabilityView,
  type Shift4ReadinessSnapshot as ReadinessData,
} from "@/lib/shift4/readinessClient"
import { supabase } from "@/lib/supabaseClient"

async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * Human labels for the capability states.
 *
 * The five categories stay visually distinct, because conflating them is what
 * makes an operator think a working credential is missing:
 *   - not configured        - nothing is stored for this merchant
 *   - configured            - a credential exists; this gate is what is missing
 *   - authenticated         - the credential is usable
 *   - disabled / blocked    - authentication is fine, a gate or prerequisite is not
 *   - certification required / enabled
 */
const STATE_LABELS: Record<string, string> = {
  not_configured: "Not configured",
  configured: "Configured",
  authenticated: "Authenticated",
  capable: "Capable",
  certification_required: "Certification required",
  certified: "Certified",
  enabled: "Enabled",
  disabled: "Disabled",
  blocked: "Blocked",
}

/** Green only for genuinely ready; amber for "authenticated but gated". */
function toneFor(item: CapabilityView): string {
  if (item.ready) return "text-emerald-700"
  if (item.state === "not_configured") return "text-gray-500"
  if (item.state === "authenticated" || item.state === "configured") return "text-blue-700"
  return "text-amber-700"
}

const CAPABILITIES = [
  "merchant_authentication",
  "ecommerce",
  "retail",
  "manual_authorization",
  "partial_approval",
  "split_tender",
  "apple_pay",
  "google_pay",
  "terminal",
  "certification",
  "production_processing",
]

/**
 * @param refreshVersion Bump this to force a refetch. Readiness is fetched
 *   client-side, so a sibling action that changes the stored credential (a
 *   successful Access Token Exchange) leaves this card showing pre-exchange
 *   state until it refetches. The parent increments the version exactly once
 *   per successful exchange; there is deliberately no polling.
 */
export default function Shift4RestReadinessCard({
  refreshVersion = 0,
}: { refreshVersion?: number } = {}) {
  const [readiness, setReadiness] = useState<ReadinessData | null>(null)

  // Re-runs on mount and whenever `refreshVersion` changes - one request each
  // time, never on an interval. `currentAccessToken` re-reads the session on
  // every run rather than capturing one at mount.
  useEffect(() => {
    let active = true
    void (async () => {
      const snapshot = await fetchShift4Readiness({ getBearerToken: currentAccessToken })
      // A failed read keeps the previous snapshot rather than blanking the card.
      if (active && snapshot) setReadiness(snapshot)
    })()
    return () => {
      active = false
    }
  }, [refreshVersion])

  if (!readiness) return null

  return (
    <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-950">Shift4 REST readiness</p>
          <p className="mt-1 text-xs text-gray-600">
            Connected credentials do not imply certified payment processing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Authentication and processing are separate facts and are shown as
              separate pills, so a connected credential is never hidden behind
              an overall "Not enabled". */}
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              readiness.authenticated ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-700"
            }`}
          >
            {readiness.authenticated ? "Authenticated" : "Not authenticated"}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              readiness.processingEnabled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {readiness.processingEnabled ? "Processing enabled" : "Processing not enabled"}
          </span>
        </div>
      </div>

      {readiness.authenticated ? (
        <p className="mt-3 text-xs text-gray-700">
          Connected channels:{" "}
          {[
            readiness.authenticatedChannels.retail ? "Retail" : null,
            readiness.authenticatedChannels.ecommerce ? "E-commerce" : null,
          ]
            .filter(Boolean)
            .join(", ") || "none"}
          . Authentication only — card processing stays disabled until its feature gate,
          terminal, certification, and production gates each pass.
        </p>
      ) : null}

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((name) => {
          const item = readiness.capabilities[name]
          if (!item) return null
          return (
            <div key={name} className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {name.replaceAll("_", " ")}
              </dt>
              <dd className={`mt-1 text-sm font-medium ${toneFor(item)}`}>
                {STATE_LABELS[item.state] ?? item.state.replaceAll("_", " ")}
              </dd>
              {/* The server-authored reason names the ONE gate that is blocking. */}
              <dd className="mt-0.5 text-[11px] leading-snug text-gray-500">{item.reason}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
