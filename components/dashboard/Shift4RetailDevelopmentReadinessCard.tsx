"use client"

type ReadinessItem = {
  label: string
  state:
    | "Complete"
    | "Partially complete"
    | "Awaiting hardware"
    | "Awaiting Shift4"
    | "Blocked by documentation"
    | "Not started"
}

/**
 * Software the published Commerce Engine For Cloud contract now covers.
 *
 * Items move off "Blocked by documentation" only when the published spec
 * genuinely resolves them. Shift4's OpenAPI v1.7.58 resolved the Cloud request
 * bodies, `POST /devices/getstatus`, the Verifone device list, the Manual
 * Authorization integration methods, and the Level 2 `purchaseCard` contract.
 * Claiming any of those were still undocumented would be false.
 */
const SOFTWARE: readonly ReadinessItem[] = [
  { label: "Retail credential verified", state: "Complete" },
  { label: "Commerce Engine Cloud request contract", state: "Complete" },
  { label: "Device status adapter (POST /devices/getstatus)", state: "Complete" },
  { label: "Device status normalization and freshness", state: "Complete" },
  { label: "Selected-reader payment preparation", state: "Complete" },
  { label: "Manual authorization (Cloud and GTV variants)", state: "Complete" },
  { label: "Referral lineage and code validation", state: "Complete" },
  { label: "Level 2 purchasing-card data", state: "Complete" },
  { label: "POS routing implemented", state: "Partially complete" },
  { label: "Transaction Engine implemented", state: "Partially complete" },
  { label: "Timeout recovery implemented", state: "Complete" },
  { label: "Accounting implemented", state: "Partially complete" },
  { label: "Certification catalog implemented", state: "Complete" },
  { label: "Fixture tests passing", state: "Complete" },
]

/**
 * Genuinely external blockers. Every one of these needs a person, a device, or
 * Shift4 — none can be closed by writing more PineTree code.
 *
 * The merchant postal code is listed because Level 2 data fails closed without
 * one: it is a real merchant-configuration prerequisite, not a code gap.
 */
const EXTERNAL: readonly ReadinessItem[] = [
  { label: "Physical PAX terminal delivery", state: "Awaiting hardware" },
  { label: "Physical Verifone terminal delivery", state: "Awaiting hardware" },
  { label: "Shift4 TMS terminal assignment", state: "Awaiting Shift4" },
  { label: "Commerce Engine provisioning", state: "Awaiting Shift4" },
  { label: "PineTree Verifone certification scope", state: "Awaiting Shift4" },
  { label: "Merchant postal code recorded", state: "Awaiting hardware" },
  { label: "Live device connectivity verified", state: "Awaiting hardware" },
  { label: "Official Retail certification", state: "Not started" },
  { label: "Production approval", state: "Not started" },
]

const stateClass: Record<ReadinessItem["state"], string> = {
  Complete: "text-emerald-700",
  "Partially complete": "text-amber-700",
  "Awaiting hardware": "text-amber-700",
  "Awaiting Shift4": "text-amber-700",
  "Blocked by documentation": "text-red-700",
  "Not started": "text-gray-600",
}

function Group({ title, items }: { title: string; items: readonly ReadinessItem[] }) {
  return <div>
    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700">{title}</h4>
    <ul className="mt-2 space-y-1.5">
      {items.map((item) => <li key={item.label} className="flex items-start justify-between gap-3 text-xs">
        <span className="text-gray-700">{item.label}</span>
        <span className={`shrink-0 font-semibold ${stateClass[item.state]}`}>{item.state}</span>
      </li>)}
    </ul>
  </div>
}

/**
 * An operator-only explanation of why truthful runtime gates remain disabled.
 * This card intentionally has no controls and reads no credentials or runtime
 * flags, so it cannot make readiness appear enabled. Software completion is not
 * runtime eligibility, and the sentence below says so.
 */
export default function Shift4RetailDevelopmentReadinessCard() {
  return <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Pre-hardware status</p>
    <h3 className="mt-1 text-sm font-semibold text-gray-950">Shift4 Retail Development Readiness</h3>
    <p className="mt-1 text-xs text-gray-600">This explains the disabled runtime gates; it does not change Retail, certification, or production eligibility.</p>
    <div className="mt-4 grid gap-5 sm:grid-cols-2"><Group title="Software" items={SOFTWARE} /><Group title="External dependencies" items={EXTERNAL} /></div>
    <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
      Commerce Engine For Cloud addresses a device by manufacturer and serial number, not by terminal ID.
      Device Information (<span className="font-mono">GET /devices/info</span>) is published for locally installed UTG only,
      so it is not a cloud terminal-listing endpoint and PineTree does not use it as one. Terminal identifiers
      still come from Shift4/TMS provisioning.
    </p>
  </section>
}
