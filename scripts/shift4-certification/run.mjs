import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { certificationCases, workbookProvenance } from "./manifest.mjs"
import { Shift4FixtureStore } from "./fixture-store.mjs"
import { Shift4FixtureAdapter } from "./fixture-adapter.mjs"
import { handleShift4FixtureApiRequest } from "./fixture-api.mjs"
import { fixtureWorkflows } from "./workflows.mjs"

const argv = process.argv.slice(2); const valueAfter = (flag, fallback = "") => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] || fallback : fallback }
const mode = valueAfter("--mode", "fixture"), channel = valueAfter("--channel", "all"), caseId = valueAfter("--case"), workflow = valueAfter("--workflow")
if (mode !== "fixture") {
  const allowed = process.env.SHIFT4_ENVIRONMENT === "test" && process.env.SHIFT4_CERTIFICATION_MODE === "true" && process.env.SHIFT4_ACCESS_TOKEN && process.env.SHIFT4_MERCHANT_CONNECTION_ID && argv.includes("--confirm-test-environment") && argv.includes("--confirm-provider-requests") && valueAfter("--allow-cases")
  if (!allowed) throw new Error("Live certification remains blocked: test environment, certification mode, credentials, merchant connection, explicit confirmation, and case allowlist are required")
  throw new Error("Live certification remains blocked: real certification adapter is intentionally not implemented")
}
let selected = certificationCases.filter((item) => channel === "all" || item.channel === channel)
if (caseId) selected = selected.filter((item) => item.id === caseId)
if (workflow) { const ids = fixtureWorkflows[workflow]; if (!ids) throw new Error(`Unknown workflow: ${workflow}`); selected = selected.filter((item) => ids.includes(item.id)) }
if (!selected.length) throw new Error("No certification cases selected")
const store = new Shift4FixtureStore(), adapter = new Shift4FixtureAdapter(store), startedAt = new Date().toISOString(); const results = []
const workflowGroupFor = (id) => Object.entries(fixtureWorkflows).find(([, ids]) => ids.includes(id))?.[0] || "standalone_case"
for (const item of selected) { const provenance = workbookProvenance[item.channel]; results.push(await handleShift4FixtureApiRequest({ mode: "fixture", testCase: { ...item, sourceWorkbookHash: provenance.sha256, workflowGroup: workflowGroupFor(item.id) } }, { adapter, store })) }
if (store.providerRequestsSent !== 0) throw new Error("Fixture isolation failed: provider request count is nonzero")
const manifestHash = createHash("sha256").update(JSON.stringify({ certificationCases, workbookProvenance, fixtureWorkflows })).digest("hex").toUpperCase()
const runId = createHash("sha256").update(JSON.stringify({ channel, workflow: workflow || null, caseIds: results.map((item) => item.caseId), manifestHash })).digest("hex").slice(0, 24)
const report = { schemaVersion: 3, mode, channel, workflow: workflow || null, runId, manifestHash, startedAt, completedAt: new Date().toISOString(), providerRequestsSent: 0, workbookProvenance, caseCount: results.length, workflows: fixtureWorkflows, results }
const outputDirectory = resolve("artifacts", "shift4-certification"); await mkdir(outputDirectory, { recursive: true }); const stamp = startedAt.replace(/[:.]/g, "-")
const jsonPath = resolve(outputDirectory, `report-${stamp}.json`); await writeFile(jsonPath, JSON.stringify(report, null, 2))
const headers = ["workbookChannel","caseId","caseTitle","phase","workflowGroup","operation","expectedResponseCode","expectedProviderOutcome","expectedAttemptState","expectedCanonicalPaymentStatus","expectedRecoveryBehavior","expectedJournalBehavior","expectedFeeBehavior","invoice","paymentId","attemptIds","normalizedOutcome","responseCode","canonicalStatus","recoveryResult","journalPostingReferences","pass","timestamp","providerRequestsSent"]
const csv = [headers.join(","), ...results.map((row) => headers.map((key) => JSON.stringify(Array.isArray(row[key]) ? row[key].join("|") : row[key] ?? "")).join(","))].join("\n")
const csvPath = resolve(outputDirectory, `report-${stamp}.csv`); await writeFile(csvPath, csv)
const markdownPath = resolve(outputDirectory, `report-${stamp}.md`); await writeFile(markdownPath, [`# Shift4 Fixture Certification Report`,``, `- Run ID: ${runId}`, `- Manifest SHA-256: ${manifestHash}`, `- Cases: ${results.length}`, `- Provider requests sent: ${store.providerRequestsSent}`, ``, `| Case | Workflow | Outcome | Canonical status | Recovery | Pass |`, `|---|---|---|---|---|---|`, ...results.map((row) => `| ${row.caseId} | ${row.workflowGroup} | ${row.normalizedOutcome} | ${row.canonicalStatus} | ${row.recoveryResult} | ${row.pass ? "PASS" : "FAIL"} |`)].join("\n"))
console.log(JSON.stringify({ ok: true, jsonPath, csvPath, markdownPath, runId, manifestHash, caseCount: results.length, providerRequestsSent: store.providerRequestsSent }))
