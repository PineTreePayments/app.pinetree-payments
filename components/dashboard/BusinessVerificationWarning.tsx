"use client"

/**
 * PineTree business-verification warning — shared merchant dashboard alert.
 *
 * DISPLAY ONLY. Every status decision is made by PineTree Engine and returned
 * by /api/onboarding/business-verification; this component renders what it is
 * given and derives no status itself.
 *
 * PRODUCT RULE: this is a compact operational warning, NOT a verification-status
 * dashboard. It exists to tell the merchant "you need to do something", and it
 * disappears the moment nothing is owed. Detailed status — including submitted,
 * pending, under review, and verified — lives in Settings.
 *
 * THE SIGNAL: PineTree Engine already computes `primaryAction`, documented as
 * "the single next action a merchant can take. Never more than one." A kind of
 * `none` means PineTree is waiting on itself or on a provider, not on the
 * merchant. That is the canonical, complete test for "the merchant owes
 * something", so this component switches on it rather than re-deriving the
 * answer from statuses it would have to keep in sync:
 *
 *   complete_profile      -> profile fields missing        -> SHOW
 *   review_and_consent    -> terms not yet accepted        -> SHOW
 *   continue_verification -> additional information needed -> SHOW
 *   none                  -> submitted / processing /
 *                            under review / verified /
 *                            temporarily unavailable       -> HIDE
 *
 * A provider/KYB state that has simply not started is therefore never enough on
 * its own: once the merchant's PineTree profile and consent are in, the Engine
 * reports `none` and this warning does not render.
 *
 * FAILURE IS NOT AN ALERT. A failed or unauthenticated read renders nothing.
 * The previous panel defaulted to a "Not started" projection when the fetch
 * failed, which showed a red "complete your business profile" banner to
 * merchants whose profile was already complete. The Interface layer must never
 * invent canonical state.
 *
 * PRESENTATION: a small red horizontal alert spanning the full width of the
 * dashboard content column. No status pill, no large title block. One line on
 * normal desktop widths; wraps naturally on smaller screens.
 */

import Link from "next/link"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabaseClient"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"

/**
 * Only what this warning actually needs. Deliberately narrow: the operational
 * alert has no business knowing the merchant's status vocabulary, so the field
 * that carries it is not read here at all.
 */
type VerificationActionKind =
  | "complete_profile"
  | "review_and_consent"
  | "continue_verification"
  | "none"

type VerificationSummary = {
  primaryAction: { kind: VerificationActionKind }
}

type VerificationApiResponse = {
  ok?: boolean
  data?: { verification?: VerificationSummary }
}

/** Where the merchant goes to act. Settings owns the detail and the controls. */
const BUSINESS_PROFILE_HREF = "/dashboard/settings?section=business-profile"

/**
 * Whether the merchant owes PineTree information or action.
 *
 * The ONLY condition that may render the red operational warning.
 */
export function requiresMerchantAction(verification: VerificationSummary | null): boolean {
  if (!verification) return false
  return verification.primaryAction.kind !== "none"
}

/** Merchant-facing copy for the one thing that is actually outstanding. */
function messageFor(kind: VerificationActionKind): { detail: string; action: string } {
  if (kind === "complete_profile") {
    return {
      detail: "Complete your business profile to continue using PineTree.",
      action: "Complete business profile",
    }
  }
  if (kind === "review_and_consent") {
    return {
      detail: "Review and accept the PineTree service terms to continue.",
      action: "Review and continue",
    }
  }
  return {
    detail: "Complete the remaining verification step to continue using PineTree.",
    action: "Complete verification",
  }
}

export default function BusinessVerificationWarning() {
  const [verification, setVerification] = useState<VerificationSummary | null>(null)

  // One read per mount. The dashboard layout persists across in-app
  // navigation, so this is one request per session rather than one per page.
  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) return

        const res = await fetch("/api/onboarding/business-verification", {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          cache: "no-store",
        })
        const payload = (await res.json().catch(() => null)) as VerificationApiResponse | null
        if (active && res.ok && payload?.ok && payload.data?.verification) {
          setVerification(payload.data.verification)
        }
      } catch {
        // Deliberately silent. See FAILURE IS NOT AN ALERT above.
      }
    })()

    return () => {
      active = false
    }
  }, [])

  if (!requiresMerchantAction(verification)) return null

  const { detail, action } = messageFor(
    (verification as VerificationSummary).primaryAction.kind
  )

  return (
    <div
      role="alert"
      className="mb-4 flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-sm shadow-none"
    >
      <span className="h-4 w-1 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
      <p className="min-w-0 flex-1 font-semibold leading-5 text-red-950">
        Business verification required
        <span className="font-normal opacity-90">{` — ${detail}`}</span>
      </p>
      <Link
        href={BUSINESS_PROFILE_HREF}
        className={`${primaryActionButtonClass} !h-8 !px-3 !text-xs whitespace-nowrap`}
      >
        {action}
      </Link>
    </div>
  )
}
