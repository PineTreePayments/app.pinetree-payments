"use client"

/**
 * Shift4 Retail Terminal — internal operator interface.
 *
 * Configures the Retail sandbox terminal and runs one explicit, read-only
 * readiness check. It sends no payment, no cardholder data, and no token
 * exchange, and it never enables card processing.
 *
 * ── Interaction discipline ───────────────────────────────────────────────────
 * The current configuration is read once on mount (a read-only GET). Everything
 * else — configuring, replacing, verifying — happens ONLY on an explicit click.
 * There is no polling and no automatic retry anywhere: a repeat is always a
 * second deliberate click. A ref blocks double submission synchronously, before
 * React can re-render with `submitting` set.
 *
 * Editing an existing record requires pressing Edit first, and submits with an
 * explicit `replace` intent, so a stale form can never silently create a second
 * terminal.
 *
 * ── Disclosure ───────────────────────────────────────────────────────────────
 * The card renders only the safe fields the routes return. The serial number is
 * displayed masked and the full value is never sent back to the browser. No
 * token, credential, provider body, header, or database detail is reachable
 * from this component.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import {
  canSubmitTerminalRequest,
  isTerminalFormComplete,
  loadRetailTerminal,
  submitRetailTerminal,
  submitRetailTerminalVerification,
  type RetailTerminalFailure,
  type RetailTerminalFormInput,
  type RetailTerminalVerification,
  type RetailTerminalView,
} from "@/lib/shift4/retailTerminalClient"
import { supabase } from "@/lib/supabaseClient"

async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/** Readable labels. Deliberately never renders "Online" for a local check. */
const READINESS_LABELS: Record<string, string> = {
  not_configured: "Not configured",
  configured: "Locally configured",
  offline: "Offline",
  online: "Online",
  disabled: "Disabled",
  certification_required: "Certification required",
  blocked: "Blocked",
  enabled: "Enabled",
}

const CONNECTIVITY_LABELS: Record<string, string> = {
  not_configured: "No terminal configured",
  unverified: "Not verified",
  offline: "Reported unavailable",
  online: "Reported available",
}

const EVIDENCE_LABELS: Record<string, string> = {
  none: "No check has been run",
  pinetree_local_configuration: "PineTree local configuration",
  shift4_status_operation: "Shift4 status operation",
}

const AWAITING_LABELS: Record<string, string> = {
  pinetree_terminal_configuration: "A terminal record configured in PineTree",
  shift4_device_assignment: "Shift4 assigning a physical or test device to this account",
  shift4_terminal_status_operation_documentation:
    "Official documentation for a Shift4 terminal-status operation",
  commerce_engine_configuration: "Commerce Engine endpoint and authentication documentation",
  shift4_certification: "Shift4 certification of this integration",
}

const EMPTY_FORM: RetailTerminalFormInput = {
  intent: "create",
  terminalId: "",
  model: "",
  serialNumber: "",
  locationId: "",
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-950 focus:border-blue-500 focus:outline-none"

export default function Shift4RetailTerminalCard() {
  const [terminal, setTerminal] = useState<RetailTerminalView | null>(null)
  const [verification, setVerification] = useState<RetailTerminalVerification | null>(null)
  const [failure, setFailure] = useState<RetailTerminalFailure | null>(null)
  const [form, setForm] = useState<RetailTerminalFormInput>(EMPTY_FORM)
  const [editing, setEditing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)

  // Refs, not state: they block a second submit synchronously, before React has
  // any chance to re-render with the pending flag set.
  const submitRef = useRef(false)
  const verifyRef = useRef(false)

  // One read-only GET on mount. No interval, and no verification is triggered.
  useEffect(() => {
    let active = true
    void (async () => {
      const outcome = await loadRetailTerminal({ getBearerToken: currentAccessToken })
      if (active && outcome.status === "success") setTerminal(outcome.result)
    })()
    return () => {
      active = false
    }
  }, [])

  const beginEdit = useCallback(() => {
    setFailure(null)
    setVerification(null)
    setForm({
      // The stored record exists, so this submission is unambiguously a replace.
      intent: terminal?.configured ? "replace" : "create",
      terminalId: terminal?.terminalId ?? "",
      model: terminal?.model ?? "",
      // Never prefilled: PineTree holds only the masked value in the browser,
      // and writing the mask back would corrupt the stored serial.
      serialNumber: "",
      locationId: terminal?.locationId ?? "",
    })
    setEditing(true)
  }, [terminal])

  const save = useCallback(async () => {
    if (submitRef.current) return
    submitRef.current = true
    setSubmitting(true)
    setFailure(null)
    setVerification(null)

    try {
      // Exactly one dispatch. No retry loop exists on any path.
      const outcome = await submitRetailTerminal({ getBearerToken: currentAccessToken }, form)
      if (outcome.status === "success") {
        setTerminal(outcome.result)
        setEditing(false)
      } else {
        setFailure(outcome.failure)
      }
    } finally {
      submitRef.current = false
      setSubmitting(false)
    }
  }, [form])

  const verify = useCallback(async () => {
    if (verifyRef.current) return
    verifyRef.current = true
    setVerifying(true)
    setFailure(null)
    setVerification(null)

    try {
      const outcome = await submitRetailTerminalVerification({
        getBearerToken: currentAccessToken,
      })
      if (outcome.status === "success") setVerification(outcome.result)
      else setFailure(outcome.failure)
    } finally {
      verifyRef.current = false
      setVerifying(false)
    }
  }, [])

  const canSave = canSubmitTerminalRequest({ submitting }) && isTerminalFormComplete(form)
  const canVerify = canSubmitTerminalRequest({ submitting: verifying })
  const configured = terminal?.configured === true

  const rows: [string, string][] = [
    ["PineTree reader ID", terminal?.readerId ?? "Not configured"],
    ["Shift4 terminal ID", terminal?.terminalId ?? "Not configured"],
    ["Device model", terminal?.model ?? "Not configured"],
    ["Serial number", terminal?.maskedSerial ?? "Not provided"],
    ["Location", terminal?.locationId ?? "Not assigned"],
    ["Integration method", terminal?.integrationMethod ?? "—"],
    ["Environment", terminal?.environment ?? "—"],
    ["Channel", terminal?.channel ?? "—"],
    [
      "Retail processing",
      terminal?.retailProcessingEnabled ? "Enabled locally" : "Disabled locally",
    ],
    [
      "Provider connectivity",
      CONNECTIVITY_LABELS[terminal?.connectivityState ?? ""] ?? "Not verified",
    ],
    ["Evidence source", EVIDENCE_LABELS[terminal?.evidenceSource ?? ""] ?? "No check has been run"],
    [
      "Last verified",
      verification?.lastVerifiedAt ? formatTimestamp(verification.lastVerifiedAt) : "Never",
    ],
    [
      "Readiness state",
      READINESS_LABELS[terminal?.readinessState ?? ""] ?? "Unknown",
    ],
  ]

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
          Terminal setup
        </p>
        <h3 className="mt-1 text-sm font-semibold text-gray-950">Shift4 Retail Terminal</h3>
        <p className="mt-1 text-xs text-gray-600">
          Records the Retail sandbox terminal identifiers PineTree holds. Configuring a terminal
          does not activate a device, enable card processing, or establish certification.
        </p>
      </div>

      {/* ── Current configuration ─────────────────────────────────────────── */}
      <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap gap-1 text-xs">
            <dt className="font-semibold text-gray-700">{label}:</dt>
            <dd className="break-all font-mono text-gray-600">{value}</dd>
          </div>
        ))}
      </dl>

      {/* ── Configure / edit ──────────────────────────────────────────────── */}
      {editing ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-3">
          <p className="text-xs font-semibold text-blue-900">
            {form.intent === "replace" ? "Replace the terminal record" : "Configure a terminal"}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-gray-700">
              Shift4 terminal ID
              <input
                type="text"
                value={form.terminalId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, terminalId: event.target.value }))
                }
                className={fieldClass}
              />
            </label>
            <label className="block text-xs font-medium text-gray-700">
              Device model
              <input
                type="text"
                value={form.model}
                onChange={(event) =>
                  setForm((current) => ({ ...current, model: event.target.value }))
                }
                className={fieldClass}
              />
            </label>
            <label className="block text-xs font-medium text-gray-700">
              Serial number (optional)
              <input
                type="text"
                value={form.serialNumber}
                onChange={(event) =>
                  setForm((current) => ({ ...current, serialNumber: event.target.value }))
                }
                className={fieldClass}
              />
            </label>
            <label className="block text-xs font-medium text-gray-700">
              PineTree location ID (optional)
              <input
                type="text"
                value={form.locationId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, locationId: event.target.value }))
                }
                className={fieldClass}
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-gray-600">
            Merchant, provider, environment, and channel are decided by the server and cannot be
            set here.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              aria-busy={submitting}
              className={`${primaryActionButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {submitting
                ? "Saving…"
                : form.intent === "replace"
                  ? "Replace terminal"
                  : "Save terminal"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={submitting}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={beginEdit}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
          >
            {configured ? "Edit terminal" : "Configure terminal"}
          </button>
          <button
            type="button"
            onClick={() => void verify()}
            disabled={!canVerify}
            aria-busy={verifying}
            className={`${primaryActionButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {verifying ? "Checking…" : "Verify Shift4 Terminal Readiness"}
          </button>
        </div>
      )}

      {/* ── Verification result ───────────────────────────────────────────── */}
      {verification ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3">
          <p className="text-sm font-semibold text-blue-900">
            {verification.configured
              ? "Locally configured — provider connectivity not yet verified"
              : "No Shift4 terminal is configured in PineTree"}
          </p>
          <p className="mt-1 text-xs text-blue-900">
            PineTree checked its own stored configuration. No request was sent to Shift4, because
            no documented Shift4 terminal-status operation is available to this integration.
          </p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {[
              ["Readiness state", READINESS_LABELS[verification.readinessState] ?? "Unknown"],
              [
                "Provider connectivity",
                CONNECTIVITY_LABELS[verification.connectivityState] ?? "Not verified",
              ],
              ["Evidence source", EVIDENCE_LABELS[verification.evidenceSource] ?? "Unknown"],
              ["Provider request sent", verification.providerCallPerformed ? "Yes" : "No"],
              ["Checked at", formatTimestamp(verification.lastVerifiedAt ?? "")],
              ["Correlation ID", verification.correlationId],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap gap-1 text-xs">
                <dt className="font-semibold text-blue-900">{label}:</dt>
                <dd className="break-all font-mono text-blue-800">{value}</dd>
              </div>
            ))}
          </dl>
          {verification.awaiting.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold text-blue-900">Still required externally</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-blue-800">
                {verification.awaiting.map((item) => (
                  <li key={item}>{AWAITING_LABELS[item] ?? item.replaceAll("_", " ")}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Failure ───────────────────────────────────────────────────────── */}
      {failure ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-sm font-semibold text-amber-900">The request did not succeed</p>
          <p className="mt-1 text-xs text-amber-900">{failure.message}</p>
          {failure.correlationId ? (
            <p className="mt-1 break-all font-mono text-xs text-amber-800">
              Correlation ID: {failure.correlationId}
            </p>
          ) : null}
          <p className="mt-2 text-xs font-medium text-amber-900">
            {failure.reviewRequired
              ? "Stop and review the configuration before trying again."
              : "You can try again when ready."}
          </p>
        </div>
      ) : null}
    </section>
  )
}
