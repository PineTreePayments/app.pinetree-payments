"use client"

/**
 * PineTree Business Profile warning - the shared merchant dashboard alert.
 *
 * ONE merchant-facing business identity concept. PineTree collects a Business
 * Profile (Settings -> Business Profile); that profile's canonical completeness
 * is the only thing this warning reports, and the only thing it may report.
 *
 * AUTHORITY: `engine/businessProfile.ts` computes `profile_status` from
 * `BUSINESS_PROFILE_REQUIRED_FIELDS`, read here through
 * `GET /api/merchant/business-profile`. Anything other than `complete` means the
 * merchant still owes PineTree information.
 *
 * NOT AUTHORITY, deliberately: provider/KYB state. Whether an infrastructure
 * partner has started, is reviewing, or has approved a merchant does not change
 * whether the merchant finished their PineTree Business Profile. A previous
 * revision drove this warning from the verification projection, which meant a
 * provider record that did not exist yet - and, worse, a failed read of that
 * projection - rendered "complete your business profile" to merchants whose
 * profile was already complete.
 *
 * FAILURE IS NOT AN ALERT. A failed or unauthenticated read renders nothing.
 * A completed Business Profile can never be turned back into an incomplete
 * merchant state by a transient read failure.
 *
 * PRESENTATION: renders the existing shared `BusinessProfileRequirementBanner`
 * (compact, red, links to Edit Profile) at the full width of the dashboard
 * content column. Mounted exactly once, in `app/dashboard/layout.tsx`, so no
 * page fetches or renders it a second time.
 */

import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import BusinessProfileRequirementBanner from "@/components/dashboard/BusinessProfileRequirementBanner"
import { supabase } from "@/lib/supabaseClient"

type BusinessProfileStatus = "incomplete" | "complete" | "needs_attention"

type BusinessProfileResponse = {
  profile?: { profile_status?: BusinessProfileStatus }
}

/** The banner's deep link returns the merchant to where they were working. */
function returnDestinationFor(pathname: string): "overview" | "wallet" | "providers" {
  if (pathname.startsWith("/dashboard/wallet")) return "wallet"
  if (pathname.startsWith("/dashboard/providers")) return "providers"
  return "overview"
}

export default function BusinessProfileWarning() {
  const pathname = usePathname()
  const [profileStatus, setProfileStatus] = useState<BusinessProfileStatus | null>(null)

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

        const res = await fetch("/api/merchant/business-profile", {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          cache: "no-store",
        })
        const payload = (await res.json().catch(() => null)) as BusinessProfileResponse | null
        if (active && res.ok && payload?.profile?.profile_status) {
          setProfileStatus(payload.profile.profile_status)
        }
      } catch {
        // Deliberately silent. See FAILURE IS NOT AN ALERT above.
      }
    })()

    return () => {
      active = false
    }
  }, [])

  // Unknown (not yet loaded, or the read failed) is never treated as incomplete.
  if (profileStatus === null || profileStatus === "complete") return null

  return (
    <div className="mb-4 w-full">
      <BusinessProfileRequirementBanner
        message="Complete Business Profile Before Continuing"
        returnDestination={returnDestinationFor(pathname)}
        compact
      />
    </div>
  )
}
