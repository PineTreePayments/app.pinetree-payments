"use client"

/**
 * PineTree business verification / wallet readiness.
 *
 * DISPLAY ONLY. Every status decision is made by PineTree Engine and returned
 * by /api/onboarding/business-verification; this component renders what it is
 * given and derives no status itself.
 *
 * PRODUCT RULE: this is NOT a provider card. It never names an infrastructure
 * partner, never shows a provider identifier or raw provider status, and
 * offers exactly ONE primary action - never separate connect / refresh /
 * enable / disable controls.
 *
 * Status refreshes automatically on mount and on return from the hosted
 * verification step. A single low-emphasis "Check status" affordance exists
 * only while verification is genuinely outstanding.
 *
 * PLACEMENT: Settings is the status home. This panel is the ONE merchant
 * surface that shows verification state in full - including the states that
 * need nothing from the merchant (submitted, in progress, under review,
 * verified). Normal operational pages carry only the compact red
 * `BusinessVerificationWarning`, which appears solely when the merchant owes an
 * action and disappears otherwise.
 *
 * A read that fails has no status. It renders "Unavailable" and never
 * back-fills a projection the Engine did not return.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { supabase } from "@/lib/supabaseClient"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import { ProviderStatusPill } from "@/components/dashboard/DashboardPrimitives"

type VerificationStatus =
  | "not_started"
  | "in_progress"
  | "under_review"
  | "action_required"
  | "verified"
  | "temporarily_unavailable"

type PrimaryAction = {
  kind: "complete_profile" | "review_and_consent" | "continue_verification" | "none"
  label: string | null
  href: string | null
}

export type BusinessVerificationSummary = {
  status: VerificationStatus
  statusLabel: string
  headline: string
  detail: string
  primaryAction: PrimaryAction
  profileComplete: boolean
  missingProfileFields: string[]
  termsAccepted: boolean
  walletCapabilitiesActive: boolean
  lastCheckedAt: string | null
}

type VerificationApiResponse = {
  ok?: boolean
  data?: {
    verification?: BusinessVerificationSummary
    verificationUrl?: string | null
  }
  error?: { message?: string }
}

/** Query flag PineTree sets on its own return route after the hosted step. */
const VERIFICATION_RETURN_PARAM = "verification"

function statusTone(status: VerificationStatus): "default" | "blue" | "amber" {
  if (status === "verified") return "blue"
  if (status === "action_required" || status === "under_review") return "amber"
  return "default"
}

/** Accent for the status dot. Presentation only; the label is Engine-authored. */
function statusAccent(status: VerificationStatus): string {
  if (status === "verified") return "bg-emerald-500"
  if (status === "action_required") return "bg-red-500"
  if (status === "under_review" || status === "in_progress") return "bg-amber-500"
  return "bg-gray-300"
}

export default function BusinessVerificationPanel() {
  const [verification, setVerification] = useState<BusinessVerificationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const refreshedOnReturn = useRef(false)

  const callApi = useCallback(
    async (path: string, method: "GET" | "POST"): Promise<VerificationApiResponse> => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error("Please sign in again")

      const res = await fetch(`/api/onboarding/business-verification${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store",
      })
      const payload = (await res.json().catch(() => null)) as VerificationApiResponse | null

      if (!res.ok || !payload?.ok) {
        // Engine-authored, merchant-safe copy only. No provider error text
        // ever reaches this component.
        throw new Error(payload?.error?.message || "Verification status is unavailable right now.")
      }
      return payload
    },
    []
  )

  const load = useCallback(
    async (options: { authoritative?: boolean } = {}) => {
      try {
        const payload = options.authoritative
          ? await callApi("/refresh", "POST")
          : await callApi("", "GET")
        if (payload.data?.verification) setVerification(payload.data.verification)
        setErrorMessage("")
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Verification status is unavailable right now."
        )
      } finally {
        setLoading(false)
      }
    },
    [callApi]
  )

  useEffect(() => {
    // Returning from the hosted step is never proof of approval, so PineTree
    // performs an authoritative provider lookup instead of trusting the return.
    const params = new URLSearchParams(window.location.search)
    const returned = params.get(VERIFICATION_RETURN_PARAM) === "returned"

    if (returned && !refreshedOnReturn.current) {
      refreshedOnReturn.current = true
      void load({ authoritative: true })
      return
    }
    void load()
  }, [load])

  async function handlePrimaryAction() {
    if (!verification) return
    const action = verification.primaryAction

    if (action.kind === "complete_profile" || action.kind === "review_and_consent") {
      if (action.href) window.location.assign(action.href)
      return
    }

    if (action.kind !== "continue_verification") return

    setBusy(true)
    setErrorMessage("")
    try {
      const payload = await callApi("/continue", "POST")
      if (payload.data?.verification) setVerification(payload.data.verification)

      const destination = payload.data?.verificationUrl
      if (destination) {
        // The compliance step is provider-hosted and is not embeddable, so
        // PineTree performs a professional same-window handoff and returns to
        // its own route, where status is re-synchronized authoritatively.
        window.location.assign(destination)
      } else {
        await load({ authoritative: true })
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to continue verification right now."
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleCheckStatus() {
    setBusy(true)
    setErrorMessage("")
    await load({ authoritative: true })
    setBusy(false)
  }

  const action = verification?.primaryAction
  const showAction = Boolean(action && action.kind !== "none" && action.label)
  // Offered only while something is genuinely outstanding - never as a way to
  // "manage" infrastructure.
  const showCheckStatus =
    verification?.status === "under_review" ||
    verification?.status === "in_progress" ||
    verification?.status === "action_required"

  /**
   * A read that has not succeeded has NO status. It is never projected as
   * "Not started" - that fabricates a canonical state the Engine did not
   * report, and it is exactly what made a fully-onboarded merchant see a
   * "complete your business profile" alert.
   */
  const statusLabel = loading
    ? "Checking"
    : verification
      ? verification.statusLabel
      : "Unavailable"

  return (
    <section
      aria-label="Business verification"
      className="rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              verification ? statusAccent(verification.status) : "bg-gray-300"
            }`}
          />
          <p className="min-w-0 text-sm font-semibold text-gray-950">
            {verification?.headline || "PineTree business verification"}
          </p>
        </div>
        <ProviderStatusPill
          label={statusLabel}
          tone={verification ? statusTone(verification.status) : "default"}
          className="shrink-0"
        />
      </div>

      <p className="mt-1.5 text-sm leading-5 text-gray-600">
        {loading
          ? "Checking your verification status..."
          : verification?.detail ||
            "Verification status is unavailable right now. Your information is saved."}
      </p>

      {verification && !verification.profileComplete && verification.missingProfileFields.length > 0 ? (
        <p className="mt-1.5 text-xs leading-5 text-gray-500">
          Still needed: {verification.missingProfileFields.slice(0, 4).join(", ")}
          {verification.missingProfileFields.length > 4
            ? ` +${verification.missingProfileFields.length - 4} more`
            : ""}
        </p>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-amber-700">
          {errorMessage}
        </p>
      ) : null}

      {showAction || showCheckStatus ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {showAction ? (
            <button
              type="button"
              onClick={() => void handlePrimaryAction()}
              disabled={busy}
              className={`${primaryActionButtonClass} whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {busy ? "Working..." : action?.label}
            </button>
          ) : null}

          {showCheckStatus ? (
            <button
              type="button"
              onClick={() => void handleCheckStatus()}
              disabled={busy}
              className="inline-flex h-9 items-center justify-center rounded-lg px-2 text-xs font-semibold text-gray-600 transition hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Check status
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
