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
 * PRESENTATION: a compact one-line notice, not a dashboard feature card. It
 * renders on normal merchant surfaces (Wallet) above balances and withdrawals,
 * so it stays a banner-height alert that states the status and offers the one
 * action. Detailed verification diagnostics belong to the admin surface.
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

/**
 * Banner treatment per status.
 *
 * This is a single-line notice, not a dashboard feature card: on Wallet it sits
 * above balances, withdrawals, and the mobile authorization control, so it must
 * never grow into a block that pushes them down the page. Red is reserved for
 * the two states where the merchant genuinely has to act; work already underway
 * reads amber, and an approved account is a quiet confirmation rather than an
 * alert.
 */
const BANNER_TONE: Record<
  VerificationStatus,
  { container: string; accent: string; text: string }
> = {
  not_started: {
    container: "border-red-200 bg-red-50/70",
    accent: "bg-red-500",
    text: "text-red-950",
  },
  action_required: {
    container: "border-red-200 bg-red-50/70",
    accent: "bg-red-500",
    text: "text-red-950",
  },
  in_progress: {
    container: "border-amber-200 bg-amber-50/70",
    accent: "bg-amber-500",
    text: "text-amber-950",
  },
  under_review: {
    container: "border-amber-200 bg-amber-50/70",
    accent: "bg-amber-500",
    text: "text-amber-950",
  },
  temporarily_unavailable: {
    container: "border-amber-200 bg-amber-50/70",
    accent: "bg-amber-500",
    text: "text-amber-950",
  },
  verified: {
    container: "border-emerald-200 bg-emerald-50/60",
    accent: "bg-emerald-500",
    text: "text-emerald-950",
  },
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

  const status = verification?.status ?? "not_started"
  const action = verification?.primaryAction
  const showAction = Boolean(action && action.kind !== "none" && action.label)
  // Offered only while something is genuinely outstanding - never as a way to
  // "manage" infrastructure.
  const showCheckStatus =
    status === "under_review" || status === "in_progress" || status === "action_required"

  const tone = BANNER_TONE[status]
  const headline = verification?.headline || "Business verification required"
  const detail = loading
    ? "Checking your verification status..."
    : verification?.detail ||
      "Complete your business profile to activate wallet and settlement capabilities."

  return (
    <section
      aria-label="Business verification"
      className={`rounded-lg border px-3 py-2 text-sm shadow-none ${tone.container}`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className={`h-4 w-1 shrink-0 rounded-full ${tone.accent}`} />

        <p className={`min-w-0 flex-1 basis-full font-semibold leading-5 sm:basis-0 ${tone.text}`}>
          {headline}
          <span className="font-normal opacity-90"> — {detail}</span>
        </p>

        <ProviderStatusPill
          label={loading ? "Checking" : verification?.statusLabel || "Not started"}
          tone={statusTone(status)}
          className="shrink-0"
        />

        {showAction ? (
          <button
            type="button"
            onClick={() => void handlePrimaryAction()}
            disabled={busy}
            className={`${primaryActionButtonClass} !h-8 !px-3 !text-xs whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {busy ? "Working..." : action?.label}
          </button>
        ) : null}

        {showCheckStatus ? (
          <button
            type="button"
            onClick={() => void handleCheckStatus()}
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold text-gray-600 transition hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Check status
          </button>
        ) : null}
      </div>

      {verification && !verification.profileComplete && verification.missingProfileFields.length > 0 ? (
        <p className="mt-1 pl-3.5 text-xs leading-5 text-gray-600">
          Still needed: {verification.missingProfileFields.slice(0, 4).join(", ")}
          {verification.missingProfileFields.length > 4
            ? ` +${verification.missingProfileFields.length - 4} more`
            : ""}
        </p>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="mt-1 pl-3.5 text-xs font-medium text-amber-700">
          {errorMessage}
        </p>
      ) : null}
    </section>
  )
}
