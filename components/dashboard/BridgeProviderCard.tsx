"use client"

/**
 * Bridge (by Stripe) provider card.
 *
 * DISPLAY ONLY. Every status decision is made by PineTree Engine and returned
 * by /api/providers/bridge/*; this component renders what it is given and
 * never derives a connection status itself.
 *
 * Bridge is a SEPARATE connection from Stripe. Nothing here reads Stripe
 * state, and a connected Stripe account never affects what this card shows.
 *
 * No raw provider error, Bridge identifier, or hosted onboarding URL is ever
 * rendered, and the card makes no approval-timing promise.
 */

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabaseClient"
import ToggleSwitch from "@/components/ui/ToggleSwitch"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import { ProviderStatusPill } from "@/components/dashboard/DashboardPrimitives"

type BridgeProviderState =
  | "coming_soon"
  | "requested"
  | "action_required"
  | "connected"
  | "enabled"
  | "disabled"

export type BridgeConnectionSummary = {
  displayName: string
  state: BridgeProviderState
  stateLabel: string
  approved: boolean
  enabled: boolean
  onboardingStarted: boolean
  kycCompleted: boolean
  tosAccepted: boolean
  baseEndorsementApproved: boolean
  outstandingRequirementCount: number
  actionRequired: { headline: string; detail: string } | null
  lastSyncedAt: string | null
  environment: "sandbox" | "production" | null
}

type BridgeApiResponse = {
  ok?: boolean
  data?: {
    connection?: BridgeConnectionSummary
    kycUrl?: string | null
    tosUrl?: string | null
    reused?: boolean
  }
  error?: { message?: string }
}

/**
 * Disabled is a normal merchant choice here, not a fault, so it is neutral
 * rather than red. Only an outstanding requirement is amber.
 */
function statusTone(state: BridgeProviderState): "default" | "blue" | "amber" {
  if (state === "connected" || state === "enabled") return "blue"
  if (state === "action_required" || state === "requested") return "amber"
  return "default"
}

function summaryLine(connection: BridgeConnectionSummary | null): string {
  if (!connection || connection.state === "coming_soon") {
    return "Not available for this account yet."
  }
  if (connection.actionRequired) return connection.actionRequired.detail
  if (connection.state === "requested") {
    return "Onboarding requested. Continue to finish business verification with Bridge."
  }
  if (connection.state === "enabled") return "Bridge settlement is on for this business."
  if (connection.state === "disabled") return "Approved by Bridge. Settlement is currently off."
  return "Approved by Bridge. Turn on settlement when you are ready."
}

export default function BridgeProviderCard({
  businessProfileComplete = true,
}: {
  businessProfileComplete?: boolean
}) {
  const [connection, setConnection] = useState<BridgeConnectionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<"onboarding" | "refresh" | "toggle" | null>(null)
  const [errorMessage, setErrorMessage] = useState("")

  const callBridgeApi = useCallback(
    async (path: string, method: "GET" | "POST"): Promise<BridgeApiResponse> => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error("Please sign in again")

      const res = await fetch(`/api/providers/bridge/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store",
      })
      const payload = (await res.json().catch(() => null)) as BridgeApiResponse | null

      if (!res.ok || !payload?.ok) {
        // Engine-authored, merchant-safe copy only. Bridge's own error text
        // never reaches this component.
        throw new Error(payload?.error?.message || "Bridge is unavailable right now.")
      }
      return payload
    },
    []
  )

  const loadStatus = useCallback(async () => {
    try {
      const payload = await callBridgeApi("status", "GET")
      setConnection(payload.data?.connection || null)
      setErrorMessage("")
    } catch (error) {
      // A failed status read must not blank the card or imply a Bridge state.
      setErrorMessage(error instanceof Error ? error.message : "Bridge is unavailable right now.")
    } finally {
      setLoading(false)
    }
  }, [callBridgeApi])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  async function startOnboarding() {
    if (!businessProfileComplete) {
      setErrorMessage("Complete your Business Profile before starting Bridge onboarding.")
      return
    }

    setBusyAction("onboarding")
    setErrorMessage("")
    try {
      const payload = await callBridgeApi("onboarding/start", "POST")
      if (payload.data?.connection) setConnection(payload.data.connection)

      const destination = payload.data?.kycUrl || payload.data?.tosUrl
      if (destination) {
        // Bridge hosts KYB collection, so documents go from the merchant's
        // browser to Bridge and never transit PineTree.
        window.open(destination, "_blank", "noopener,noreferrer")
      } else {
        toast.info("Bridge onboarding is in progress. Use Refresh status to check for updates.")
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to start Bridge onboarding.")
    } finally {
      setBusyAction(null)
    }
  }

  async function refreshStatus() {
    setBusyAction("refresh")
    setErrorMessage("")
    try {
      // Approval is confirmed against Bridge, never against a browser redirect.
      const payload = await callBridgeApi("sync", "POST")
      if (payload.data?.connection) setConnection(payload.data.connection)
      toast.success("Bridge status updated")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to refresh Bridge status.")
    } finally {
      setBusyAction(null)
    }
  }

  async function toggleEnabled(next: boolean) {
    setBusyAction("toggle")
    setErrorMessage("")
    try {
      const payload = await callBridgeApi(next ? "enable" : "disable", "POST")
      if (payload.data?.connection) setConnection(payload.data.connection)
      toast.success(next ? "Bridge enabled" : "Bridge disabled")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to update Bridge.")
    } finally {
      setBusyAction(null)
    }
  }

  const state = connection?.state ?? "coming_soon"
  const statusLabel = loading ? "Loading" : connection?.stateLabel || "Coming soon"
  const available = state !== "coming_soon"
  const onboardingLabel = connection?.onboardingStarted ? "Continue onboarding" : "Start onboarding"
  const canToggle = Boolean(connection?.approved)
  const busy = busyAction !== null

  return (
    <div className="flex min-h-[226px] flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-200 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-base font-semibold leading-tight text-gray-950">
          Bridge by Stripe
        </h2>
        <ProviderStatusPill label={statusLabel} tone={statusTone(state)} className="shrink-0" />
      </div>

      <div className="mt-4 space-y-2.5">
        <div className="grid grid-cols-[92px_1fr] items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Networks
          </span>
          <span className="min-w-0 text-sm leading-snug text-gray-900">Stablecoin</span>
        </div>
        <div className="grid grid-cols-[92px_1fr] items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Settlement
          </span>
          <span className="min-w-0 text-sm leading-snug text-gray-900">Bridge merchant account</span>
        </div>
        <p className="pt-1 text-sm leading-5 text-gray-600">
          Stablecoin conversion and merchant settlement through Bridge. Business verification is
          completed with Bridge and is separate from your Stripe account.
        </p>
      </div>

      <div className="mt-4 min-h-[50px]">
        {available ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {connection?.actionRequired ? connection.actionRequired.headline : "Provider status"}
            </span>
            <span className="mt-1 block text-sm font-medium leading-snug text-gray-950">
              {summaryLine(connection)}
            </span>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Bridge verification progress">
              <li className="text-xs leading-5 text-gray-500">
                Terms: {connection?.tosAccepted ? "Accepted" : "Not accepted"}
              </li>
              <li className="text-xs leading-5 text-gray-500">
                Business verification: {connection?.kycCompleted ? "Complete" : "Incomplete"}
              </li>
              {connection && connection.outstandingRequirementCount > 0 ? (
                <li className="text-xs leading-5 text-gray-500">
                  {connection.outstandingRequirementCount} item
                  {connection.outstandingRequirementCount === 1 ? "" : "s"} outstanding
                </li>
              ) : null}
            </ul>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Provider status
            </span>
            <span className="mt-1 block text-sm font-medium leading-snug text-gray-950">
              {loading ? "Checking availability..." : summaryLine(connection)}
            </span>
          </div>
        )}

        {errorMessage ? (
          <p role="alert" className="mt-2 text-xs font-medium text-amber-700">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void startOnboarding()}
            disabled={!available || busy}
            className={`${primaryActionButtonClass} min-w-[150px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {busyAction === "onboarding" ? "Starting..." : onboardingLabel}
          </button>
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={!available || busy || !connection?.onboardingStarted}
            className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyAction === "refresh" ? "Refreshing..." : "Refresh status"}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-medium text-gray-700">
            {connection?.enabled ? "Enabled" : "Disabled"}
          </span>
          <ToggleSwitch
            checked={Boolean(connection?.enabled)}
            disabled={!canToggle || busy}
            onChange={(value) => void toggleEnabled(value)}
          />
        </div>
      </div>
    </div>
  )
}
