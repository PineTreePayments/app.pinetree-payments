"use client"

import { useMemo, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import Shift4HostedCheckoutPanel, { type Shift4CheckoutUiState } from "@/components/payment/Shift4HostedCheckoutPanel"
import Shift4RetailTerminalPanel, { type Shift4RetailUiState } from "@/components/payment/Shift4RetailTerminalPanel"

type ReadinessResult = {
  merchantId: string
  readiness: { processingEnabled: boolean; environment: string | null; capabilities: Record<string, { state: string; ready: boolean; reason: string }> }
  diagnostics?: { capabilityExplanations: Record<string, { state: string; reason: string }> }
  certificationMatrix: { ecommerceCases: number; retailCases: number; liveExecutionEnabled: boolean }
}
type FixtureCase = { caseId: string; status: string; pass: boolean; expectedCanonicalPaymentStatus: string; expectedRecoveryBehavior: string }
type FixtureEvidence = {
  generatedAt: string
  runId: string
  manifestHash: string
  providerRequestsSent: number
  workflow?: string | null
  cases: FixtureCase[]
  fixtureState: {
    checkout: { states: Shift4CheckoutUiState[]; session: unknown; callback: unknown; consumption: unknown; demonstrations: string[] }
    retail: { states: Shift4RetailUiState[]; maximumInactivityMs: number; keypadLockedWhileActive: boolean; cancelReleasesSession: boolean; timeoutEntersRecovery: boolean; engineResults: unknown[] }
    onboarding: { providerApplicationId: string; launchReference: string; correlationId: string; reasonCode: string; progression: string[]; terminalStates: string[]; manualReviewRequired: boolean }
    structuredEmail: Record<string, unknown>
    canonicalResult: unknown
    attempts: unknown[]
    tenders: unknown[]
    recovery: unknown[]
    journalReferences: string[]
  }
}

const WORKFLOWS = ["authorization_capture", "approval_void", "referral_manual_capture", "partial_additional_tender", "timeout_lookup", "timeout_not_found_resend_decision", "refund_distinct_invoice", "avs_csc"]
const CASE_IDS = [
  ...Array.from({ length: 23 }, (_, index) => `ecommerce-${index < 14 ? "evaluated" : "attest"}-${index + 1}`),
  ...Array.from({ length: 26 }, (_, index) => `retail-${index < 18 ? "evaluated" : "attest"}-${index + 1}`),
]

export default function Shift4CertificationAdminPage() {
  const [merchantId, setMerchantId] = useState("")
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null)
  const [message, setMessage] = useState("")
  const [evidence, setEvidence] = useState<FixtureEvidence | null>(null)
  const [channel, setChannel] = useState<"all" | "ecommerce" | "retail">("all")
  const [workflow, setWorkflow] = useState("")
  const [caseId, setCaseId] = useState("")
  const [checkoutState, setCheckoutState] = useState<Shift4CheckoutUiState>("not_configured")
  const [retailState, setRetailState] = useState<Shift4RetailUiState>("choose_reader")
  const [emailScenario, setEmailScenario] = useState("trusted")

  const availableCases = useMemo(() => CASE_IDS.filter((id) => channel === "all" || id.startsWith(`${channel}-`)), [channel])

  const adminHeaders = async () => {
    const { data } = await supabase.auth.getSession()
    return { authorization: `Bearer ${data.session?.access_token || ""}`, "content-type": "application/json" }
  }

  const loadReadiness = async () => {
    setMessage("")
    const response = await fetch(`/api/admin/shift4/readiness?merchantId=${encodeURIComponent(merchantId.trim())}`, { headers: await adminHeaders(), cache: "no-store" })
    const body = await response.json().catch(() => null) as { data?: ReadinessResult; error?: { message?: string } } | null
    if (!response.ok || !body?.data) { setReadiness(null); setMessage(body?.error?.message || "Unable to load readiness"); return }
    setReadiness(body.data)
  }

  const runFixtures = async (selection: "case" | "workflow" | "all") => {
    setMessage("")
    const payload: Record<string, unknown> = { mode: "fixture", channel }
    if (selection === "case") payload.caseIds = [caseId]
    if (selection === "workflow") payload.workflow = workflow
    const response = await fetch("/api/admin/shift4/certification", { method: "POST", headers: await adminHeaders(), body: JSON.stringify(payload) })
    const body = await response.json().catch(() => null) as { data?: FixtureEvidence; error?: { message?: string } } | null
    if (!response.ok || !body?.data) { setMessage(body?.error?.message || "Unable to validate fixtures"); return }
    setEvidence(body.data)
    setCheckoutState(body.data.fixtureState.checkout.states[0])
    setRetailState(body.data.fixtureState.retail.states[0])
  }

  const exportEvidence = (format: "json" | "csv" | "markdown") => {
    if (!evidence) return
    const content = format === "json" ? JSON.stringify(evidence, null, 2)
      : format === "csv" ? ["caseId,status,pass,providerRequestsSent,canonicalStatus,recovery", ...evidence.cases.map((item) => [item.caseId, item.status, item.pass, 0, item.expectedCanonicalPaymentStatus, item.expectedRecoveryBehavior].map((value) => JSON.stringify(value)).join(","))].join("\n")
        : ["# Shift4 Fixture Evidence", "", `Run ID: ${evidence.runId}`, `Manifest SHA-256: ${evidence.manifestHash}`, `Provider requests sent: **${evidence.providerRequestsSent}**`, "", "| Case | Status | Canonical |", "|---|---|---|", ...evidence.cases.map((item) => `| ${item.caseId} | ${item.status} | ${item.expectedCanonicalPaymentStatus} |`)].join("\n")
    const extension = format === "markdown" ? "md" : format
    const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/plain" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `shift4-fixture-evidence-${evidence.runId}.${extension}`
    link.click()
    URL.revokeObjectURL(url)
  }

  return <div className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Admin-only synthetic environment</p><h1 className="mt-1 text-2xl font-semibold text-gray-950">Shift4 fixture and readiness console</h1><p className="mt-2 text-sm text-gray-600">All transaction controls below use Engine-owned synthetic fixtures. No provider or PostgreSQL request is available from this page.</p></div>

    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-gray-950">Server-derived merchant readiness</h2>
      <div className="flex max-w-2xl gap-2"><input aria-label="Merchant ID" value={merchantId} onChange={(event) => setMerchantId(event.target.value)} placeholder="Merchant UUID" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void loadReadiness()} disabled={!merchantId.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Inspect</button></div>
      {readiness ? <><div className="grid gap-2 md:grid-cols-2">{Object.entries(readiness.readiness.capabilities).map(([name, capability]) => <div key={name} className="rounded-lg border border-gray-100 p-3"><div className="flex justify-between gap-3"><span className="text-sm font-medium">{name.replaceAll("_", " ")}</span><span className={capability.ready ? "text-xs text-emerald-700" : "text-xs text-amber-700"}>{capability.state.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-gray-500">{capability.reason}</p></div>)}</div>{readiness.diagnostics ? <SafeState title="Canonical readiness explanations" value={readiness.diagnostics.capabilityExplanations} /> : null}</> : null}
    </section>

    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-gray-950">Certification fixture selection</h2>
      <div className="grid gap-2 lg:grid-cols-3"><select aria-label="Fixture channel" value={channel} onChange={(event) => { setChannel(event.target.value as typeof channel); setCaseId("") }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="all">All channels</option><option value="ecommerce">E-commerce</option><option value="retail">Retail</option></select><select aria-label="Fixture case" value={caseId} onChange={(event) => setCaseId(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">Select one of {availableCases.length} cases</option>{availableCases.map((id) => <option key={id} value={id}>{id}</option>)}</select><select aria-label="Fixture workflow" value={workflow} onChange={(event) => setWorkflow(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">Select grouped workflow</option>{WORKFLOWS.map((name) => <option key={name} value={name}>{name.replaceAll("_", " ")}</option>)}</select></div>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!caseId} onClick={() => void runFixtures("case")} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Run one case</button><button type="button" disabled={!workflow} onClick={() => void runFixtures("workflow")} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Run workflow</button><button type="button" onClick={() => void runFixtures("all")} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Run all selected-channel cases</button><button type="button" onClick={() => { setEvidence(null); setMessage("Synthetic in-memory fixture view reset") }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold">Reset synthetic state</button>{(["json", "csv", "markdown"] as const).map((format) => <button key={format} type="button" disabled={!evidence} onClick={() => exportEvidence(format)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">Export {format === "markdown" ? "Markdown" : format.toUpperCase()}</button>)}</div>
      {evidence ? <p className="text-sm text-emerald-700">{evidence.cases.length} cases passed; providerRequestsSent: {evidence.providerRequestsSent}; run {evidence.runId}</p> : null}
    </section>

    {message ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</p> : null}

    {evidence ? <>
      <section className="grid gap-4 xl:grid-cols-2"><div className="space-y-3"><h2 className="font-semibold text-gray-950">Hosted-checkout fixture states</h2><select aria-label="Checkout fixture state" value={checkoutState} onChange={(event) => setCheckoutState(event.target.value as Shift4CheckoutUiState)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">{evidence.fixtureState.checkout.states.map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}</select><Shift4HostedCheckoutPanel state={checkoutState} readinessReason={readiness?.readiness.capabilities.hosted_checkout?.reason} /></div><div className="space-y-3"><h2 className="font-semibold text-gray-950">Retail fixture states</h2><select aria-label="Retail fixture state" value={retailState} onChange={(event) => setRetailState(event.target.value as Shift4RetailUiState)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">{evidence.fixtureState.retail.states.map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}</select><Shift4RetailTerminalPanel state={retailState} deviceLabel="Synthetic Shift4 reader" /></div></section>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><SafeState title="Checkout/tokenization" value={evidence.fixtureState.checkout} /><SafeState title="Retail Engine/simulator" value={evidence.fixtureState.retail} /><SafeState title="Onboarding progression" value={evidence.fixtureState.onboarding} /><div className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="text-sm font-semibold text-gray-950">Synthetic structured-email form</h3><select aria-label="Structured email fixture" value={emailScenario} onChange={(event) => setEmailScenario(event.target.value)} className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">{["trusted", "untrusted", "duplicate", "missingCorrelation", "attachment"].map((name) => <option key={name} value={name}>{name.replaceAll(/([A-Z])/g, " $1").toLowerCase()}</option>)}</select><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-600">{JSON.stringify(evidence.fixtureState.structuredEmail[emailScenario], null, 2)}</pre><p className="mt-2 text-xs text-gray-500">Predefined synthetic metadata only; no mailbox or attachment content.</p></div><SafeState title="Attempt/tender/recovery" value={{ attempts: evidence.fixtureState.attempts, tenders: evidence.fixtureState.tenders, recovery: evidence.fixtureState.recovery }} /><SafeState title="Canonical result / journal" value={{ canonicalResult: evidence.fixtureState.canonicalResult, journalReferences: evidence.fixtureState.journalReferences }} /></section>
    </> : null}
  </div>
}

function SafeState({ title, value }: { title: string; value: unknown }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="text-sm font-semibold text-gray-950">{title}</h3><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-600">{JSON.stringify(value, null, 2)}</pre></div>
}
