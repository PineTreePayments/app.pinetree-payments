"use client"

/**
 * Shift4 Sandbox Operations - internal operator section.
 *
 * Renders the Shift4 credential-exchange and raw readiness tools. These are
 * internal testing surfaces, not merchant features, and they are mounted only
 * inside the authenticated Admin dashboard.
 *
 * ── Presentation ─────────────────────────────────────────────────────────────
 * Admin shows ONE compact card with a short status summary. The tools open in a
 * dialog on top of it. They used to render expanded down the page, which turned
 * Admin Overview into a long technical document about a surface that is only
 * touched deliberately. Nothing was removed: every card, control, and piece of
 * state below lives inside the dialog, unchanged.
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

import { useCallback, useEffect, useState, type ReactNode } from "react"

import Shift4RestReadinessCard from "@/components/dashboard/Shift4RestReadinessCard"
import Shift4RetailConnectCard from "@/components/dashboard/Shift4RetailConnectCard"
import Shift4RetailDevelopmentReadinessCard from "@/components/dashboard/Shift4RetailDevelopmentReadinessCard"
import Shift4RetailTerminalCard from "@/components/dashboard/Shift4RetailTerminalCard"
import Shift4RetailVerificationCard from "@/components/dashboard/Shift4RetailVerificationCard"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import {
  fetchShift4Readiness,
  type Shift4ReadinessSnapshot,
} from "@/lib/shift4/readinessClient"
import { supabase } from "@/lib/supabaseClient"

async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

type SummaryLine = { label: string; value: string; ready: boolean | null }

/**
 * The three lines on the collapsed card, projected from the same server
 * snapshot the readiness card inside the dialog renders in full.
 *
 * A null snapshot means there was no session, the read failed, or the REST gate
 * is off. That is reported as "Unavailable" rather than guessed at - a summary
 * that invented "Not connected" would be indistinguishable from a real answer.
 */
function summarize(readiness: Shift4ReadinessSnapshot | null): SummaryLine[] {
  if (!readiness) {
    return [
      { label: "Retail connection", value: "Unavailable", ready: null },
      { label: "Readiness", value: "Unavailable", ready: null },
      { label: "Certification", value: "Unavailable", ready: null },
    ]
  }

  const certification = readiness.capabilities.certification
  return [
    {
      label: "Retail connection",
      value: readiness.authenticatedChannels.retail ? "Connected" : "Not connected",
      ready: readiness.authenticatedChannels.retail,
    },
    {
      label: "Readiness",
      value: readiness.processingEnabled ? "Processing enabled" : "Processing not enabled",
      ready: readiness.processingEnabled,
    },
    {
      label: "Certification",
      value: certification ? sentenceCase(certification.state) : "Unavailable",
      ready: certification ? certification.ready : null,
    },
  ]
}

/** "certification_required" -> "Certification required". */
function sentenceCase(state: string): string {
  const words = state.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function summaryToneClass(ready: boolean | null): string {
  if (ready === true) return "text-emerald-700"
  if (ready === false) return "text-amber-700"
  return "text-gray-500"
}

/**
 * One labeled area inside the dialog.
 *
 * The tools were built as five independent cards, so dropping them into a
 * window read as five unrelated panels. The label is PineTree's subtle blue
 * section treatment and groups by what an operator is actually doing; the cards
 * themselves are unchanged and keep their own specific titles.
 */
function OperatorToolGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
        {title}
      </p>
      {children}
    </section>
  )
}

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
  const [toolsOpen, setToolsOpen] = useState(false)
  const [summary, setSummary] = useState<Shift4ReadinessSnapshot | null>(null)

  // The summary's own read of the same authenticated PineTree route the
  // readiness card uses. Keyed on the exchange counter for the same reason that
  // card is: a successful exchange changes server state this snapshot cannot
  // observe. One request per change, never on an interval, and only once the
  // server has authorized this operator.
  useEffect(() => {
    if (authorized !== true) return
    let active = true
    void (async () => {
      const snapshot = await fetchShift4Readiness({ getBearerToken: currentAccessToken })
      // A failed read keeps the previous summary rather than blanking it.
      if (active && snapshot) setSummary(snapshot)
    })()
    return () => {
      active = false
    }
  }, [authorized, readinessVersion])

  // Escape closes the dialog, matching every other PineTree overlay.
  useEffect(() => {
    if (!toolsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toolsOpen])

  if (authorized !== true) return null

  const summaryLines = summarize(summary)

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
              Internal operator tools
            </p>
            <h2 className="mt-1 text-base font-semibold text-gray-950">
              Shift4 Sandbox Operations
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-600">
              Shift4 sandbox, certification, readiness, and terminal operations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setToolsOpen(true)}
            className={`${primaryActionButtonClass} sm:self-center`}
          >
            Open Operator Tools
          </button>
        </div>

        <dl className="mt-4 grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-3">
          {summaryLines.map((line) => (
            <div key={line.label} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                {line.label}
              </dt>
              <dd className={`mt-0.5 text-sm font-medium ${summaryToneClass(line.ready)}`}>
                {line.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {toolsOpen ? (
        <div
          data-pinetree-overlay="true"
          className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-start justify-center p-3 sm:items-center"
          onMouseDown={() => setToolsOpen(false)}
        >
          {/* Wider than the old 880px so the cards' own two- and three-column
              grids have room at laptop widths instead of forcing the dialog to
              scroll sideways. Still `w-full` under that, so a narrow screen
              gets a single column rather than a clipped one. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Shift4 operator tools"
            className="relative flex max-h-[92vh] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-lg"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex flex-none items-start justify-between gap-4 border-b border-gray-100 p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">
                  Internal operator tools
                </p>
                <h2 className="mt-1 text-lg font-semibold text-gray-950">
                  Shift4 Sandbox Operations
                </h2>
                <p className="mt-1 text-sm leading-5 text-gray-600">
                  Establishes encrypted Shift4 test authentication for this account. It does not
                  enable card processing, certification, or production, and it never sends a
                  payment.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setToolsOpen(false)}
                aria-label="Close operator tools"
                className={modalCloseButtonClass}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* The tools themselves scroll VERTICALLY inside the dialog, so the
                Admin page behind it stays where the operator left it. `min-w-0`
                runs down the whole chain — dialog, body, group, card, and the
                evidence tiles inside each card — because a grid or flex child
                defaults to min-width:auto and a long fingerprint or correlation
                id would otherwise push the dialog wider than the viewport
                instead of wrapping. Nothing is clipped and nothing is hidden. */}
            <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
              <OperatorToolGroup title="Retail connection">
                <Shift4RetailConnectCard onConnectionChanged={handleConnectionChanged} />
                {/* Read-only. Uses the credential the card above already stored; it never
                    exchanges, replaces, or clears one. */}
                <Shift4RetailVerificationCard />
              </OperatorToolGroup>

              <OperatorToolGroup title="Terminal setup">
                {/* Terminal identifiers only. Configuring one activates no device and
                    enables no processing; it never contacts Shift4. */}
                <Shift4RetailTerminalCard />
              </OperatorToolGroup>

              <OperatorToolGroup title="REST readiness">
                <Shift4RestReadinessCard refreshVersion={readinessVersion} />
              </OperatorToolGroup>

              <OperatorToolGroup title="Development readiness">
                <Shift4RetailDevelopmentReadinessCard />
              </OperatorToolGroup>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
