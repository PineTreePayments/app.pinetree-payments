"use client"

/**
 * Shift4 Retail sandbox credential connection - merchant operator interface.
 *
 * Performs ONE Retail sandbox Access Token Exchange through the existing
 * authenticated route, so an operator never has to extract a PineTree bearer
 * token into PowerShell, Postman, or devtools.
 *
 * ── Auth Token handling ──────────────────────────────────────────────────────
 * The Shift4 Auth Token lives in React state and nowhere else. It is never
 * written to localStorage, sessionStorage, a cookie, or a query string; never
 * sent to analytics, telemetry, or the console; and never placed in an error
 * message. State is cleared BEFORE the request is dispatched - a stronger
 * guarantee than clearing afterwards, because no re-render during the request
 * can put the value back on screen, and neither a success nor a failure path
 * can leave it behind.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 * Retail only, sandbox only. The channel is a hardcoded constant with no
 * selector. This establishes encrypted authentication; it does not enable card
 * processing, certification, or production, and it never touches the
 * E-commerce credential.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import {
  canSubmitRetailConnection,
  RETAIL_CONFIRMATION_TEXT,
  SHIFT4_CONNECT_PATH,
  submitRetailConnection,
  type RetailConnectFailure,
  type RetailConnectResult,
} from "@/lib/shift4/retailConnect"
import { supabase } from "@/lib/supabaseClient"

type ConnectSurface = {
  enabled: boolean
  disabledReason: string | null
  merchantTimeZone: string | null
  merchantTimeZoneValid: boolean
  retail: {
    connected: boolean
    accessTokenFingerprint: string | null
    connectedAt: string | null
    lastExchangeCorrelationId: string | null
  } | null
  ecommerceConnected: boolean
  legacySharedCredentialPresent: boolean
}

async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export default function Shift4RetailConnectCard() {
  const [surface, setSurface] = useState<ConnectSurface | null>(null)
  const [authToken, setAuthToken] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<RetailConnectResult | null>(null)
  const [failure, setFailure] = useState<RetailConnectFailure | null>(null)

  // A ref, not state: it blocks a second submit synchronously, before React has
  // any chance to re-render with `submitting` set.
  const inFlightRef = useRef(false)

  const loadSurface = useCallback(async () => {
    const token = await currentAccessToken()
    if (!token) return null
    const response = await fetch(SHIFT4_CONNECT_PATH, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: ConnectSurface }
      | null
    return response.ok && body?.ok && body.data ? body.data : null
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const loaded = await loadSurface().catch(() => null)
      if (active) setSurface(loaded)
    })()
    return () => {
      active = false
    }
  }, [loadSurface])

  const submit = useCallback(async () => {
    // Double-submit guard. A single-use production auth token makes an
    // accidental second dispatch genuinely costly, so this is checked first.
    if (inFlightRef.current) return
    if (!surface?.enabled || !surface.merchantTimeZoneValid || !confirmed) return

    const token = authToken.trim()
    const merchantTimeZone = surface.merchantTimeZone
    if (!token || !merchantTimeZone) return

    inFlightRef.current = true
    setSubmitting(true)
    setFailure(null)
    setResult(null)

    try {
      // Exactly one dispatch, no automatic retry. `onTokenConsumed` clears the
      // field before the request leaves, so no render can show it again.
      const outcome = await submitRetailConnection({
        authToken: token,
        merchantTimeZone,
        getBearerToken: currentAccessToken,
        onTokenConsumed: () => setAuthToken(""),
      })

      if (outcome.status === "success") {
        setResult(outcome.result)
        setConfirmed(false)
        setReplacing(false)
        setSurface(await loadSurface().catch(() => surface))
        return
      }

      setFailure(outcome.failure)
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
      // Belt and braces: the token was already cleared before dispatch, and is
      // cleared again on every exit path.
      setAuthToken("")
    }
  }, [authToken, confirmed, loadSurface, surface])

  // Renders only for an authenticated merchant whose deployment has the REST
  // gate on and is targeting the Shift4 test host.
  if (!surface?.enabled) return null

  const retailConnected = surface.retail?.connected === true
  const formVisible = !retailConnected || replacing
  const timeZoneBlocked = !surface.merchantTimeZoneValid
  const canSubmit = canSubmitRetailConnection({
    enabled: surface.enabled,
    merchantTimeZoneValid: surface.merchantTimeZoneValid,
    confirmed,
    authToken,
    submitting,
    formVisible,
  })

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-950">Shift4 Retail sandbox connection</p>
          <p className="mt-1 text-xs text-gray-600">
            Exchanges one Retail Auth Token for an encrypted sandbox credential. This establishes
            authentication only — it does not enable card processing or send a payment.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            retailConnected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {retailConnected ? "Retail connected" : "Retail not connected"}
        </span>
      </div>

      {/* ── Existing connection ─────────────────────────────────────────── */}
      {retailConnected && surface.retail ? (
        <dl className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Credential fingerprint
            </dt>
            <dd className="mt-1 break-all font-mono text-sm text-gray-900">
              {surface.retail.accessTokenFingerprint || "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Connected
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {surface.retail.connectedAt ? formatTimestamp(surface.retail.connectedAt) : "—"}
            </dd>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Last correlation ID
            </dt>
            <dd className="mt-1 break-all font-mono text-xs text-gray-700">
              {surface.retail.lastExchangeCorrelationId || "—"}
            </dd>
          </div>
        </dl>
      ) : null}

      {retailConnected && !replacing ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
          >
            Replace Retail connection
          </button>
          <p className="mt-2 text-xs text-gray-600">
            Replacing performs another Shift4 exchange and requires a new Auth Token. The
            E-commerce credential is not affected.
          </p>
        </div>
      ) : null}

      {/* ── Exchange form ───────────────────────────────────────────────── */}
      {formVisible ? (
        <div className="mt-4 space-y-3">
          {retailConnected ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This replaces the existing Retail credential by performing another Shift4 exchange.
              The E-commerce channel is never modified.
            </p>
          ) : null}

          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Merchant time zone
            </p>
            <p className="mt-1 text-sm text-gray-900">{surface.merchantTimeZone || "Not configured"}</p>
            {timeZoneBlocked ? (
              <p className="mt-1 text-xs font-medium text-red-700">
                Shift4 requires the merchant&apos;s local time. Set a valid time zone in Settings
                before connecting.
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-600">
                Sent with the request as the merchant&apos;s local time.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="shift4-retail-auth-token"
              className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"
            >
              Shift4 Retail Auth Token
            </label>
            <input
              id="shift4-retail-auth-token"
              // A password input keeps the value masked and out of browser
              // autofill history.
              type="password"
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              disabled={submitting || timeZoneBlocked}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              // Ask common password managers not to capture a single-use token.
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              placeholder="Paste the single-use Auth Token"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 disabled:bg-gray-100"
            />
            <p className="mt-1 text-xs text-gray-600">
              Issued by the merchant&apos;s Lighthouse Transaction Manager Account Administrator.
              PineTree never stores it and clears it from this page as soon as the request is sent.
            </p>
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-800">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={submitting}
              className="mt-0.5"
            />
            <span>{RETAIL_CONFIRMATION_TEXT}</span>
          </label>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className={`${primaryActionButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {submitting ? "Connecting…" : "Connect Shift4 Retail Sandbox"}
          </button>
        </div>
      ) : null}

      {/* ── Success ─────────────────────────────────────────────────────── */}
      {result ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
          <p className="text-sm font-semibold text-emerald-900">Retail credential connected</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {[
              ["Connection ID", result.connectionId],
              ["Environment", result.environment],
              ["Channel", result.channel],
              ["Access token fingerprint", result.accessTokenFingerprint],
              ["Connected at", formatTimestamp(result.connectedAt)],
              ["Correlation ID", result.correlationId],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap gap-1 text-xs">
                <dt className="font-semibold text-emerald-900">{label}:</dt>
                <dd className="break-all font-mono text-emerald-800">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-emerald-800">
            Authentication only. Card processing stays disabled until its own gates and
            certification are satisfied.
          </p>
        </div>
      ) : null}

      {/* ── Failure ─────────────────────────────────────────────────────── */}
      {failure ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3">
          <p className="text-sm font-semibold text-red-900">{failure.message}</p>
          {failure.correlationId ? (
            <p className="mt-1 break-all font-mono text-xs text-red-800">
              Correlation ID: {failure.correlationId}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-red-800">
            {failure.outcomeUnclear
              ? "The outcome is unclear. Stop and review the connection status with Shift4 before trying again — the exchange may have succeeded, and an Auth Token is single-use."
              : "Enter a new Auth Token to try again. Auth Tokens are single-use."}
          </p>
        </div>
      ) : null}

      {surface.ecommerceConnected ? (
        <p className="mt-3 text-xs text-gray-600">
          An E-commerce credential is also stored. This interface never modifies it.
        </p>
      ) : null}
    </div>
  )
}
