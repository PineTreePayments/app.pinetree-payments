"use client"

/**
 * Shift4 Sandbox Operations - internal operator section.
 *
 * Renders the Shift4 credential-exchange and raw readiness tools. These are
 * internal testing surfaces, not merchant features, and they are mounted only
 * inside the authenticated Admin dashboard.
 *
 * ── Authorization ────────────────────────────────────────────────────────────
 * Rendering is decided ENTIRELY by the server. The parent passes `authorized`,
 * which comes from `GET /api/admin/me` -> `getShift4OperatorStatusFromRequest`,
 * a single boolean. This component never sees, compares, or receives an email
 * address, and the configured operator address never enters the client bundle.
 *
 * Unauthorized admins render nothing at all - not hidden markup, not a
 * placeholder. The section is also absent until the server has answered, so the
 * controls cannot flash before authorization resolves. The routes behind these
 * cards enforce the same authorization independently, so hiding the UI is a
 * convenience, never the security boundary.
 */

import { useCallback, useState } from "react"

import Shift4RestReadinessCard from "@/components/dashboard/Shift4RestReadinessCard"
import Shift4RetailConnectCard from "@/components/dashboard/Shift4RetailConnectCard"

export default function Shift4SandboxOperationsSection({
  authorized,
}: {
  /**
   * Server-decided. Undefined while `/api/admin/me` is still in flight, which
   * renders nothing rather than briefly exposing the controls.
   */
  authorized: boolean | undefined
}) {
  // Bumped once after a successful credential exchange so the readiness card
  // refetches. Both cards own client-fetched state, so a server re-render would
  // not update either of them.
  const [readinessVersion, setReadinessVersion] = useState(0)
  const handleConnectionChanged = useCallback(
    () => setReadinessVersion((version) => version + 1),
    []
  )

  if (authorized !== true) return null

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
          Internal operator tools
        </p>
        <h2 className="mt-1 text-lg font-semibold text-gray-950">Shift4 Sandbox Operations</h2>
        <p className="mt-1 text-sm text-gray-600">
          Establishes encrypted Shift4 test authentication for this account. It does not enable
          card processing, certification, or production, and it never sends a payment.
        </p>
      </div>
      <Shift4RetailConnectCard onConnectionChanged={handleConnectionChanged} />
      <Shift4RestReadinessCard refreshVersion={readinessVersion} />
    </section>
  )
}
