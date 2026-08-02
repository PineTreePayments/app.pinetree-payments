import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { normalizeShift4CertificationEvidence, runShift4CertificationFixture, serializeShift4CertificationEvidence } from "@/engine/shift4/certificationService"
import { safeShift4LogFields } from "@/engine/shift4/observability"
import { redactShift4Payload } from "@/providers/shift4/rest/redact"

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), "utf8")
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex").toUpperCase()
const originalFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = async () => { throw new Error("Unexpected provider/network request from ordinary test") }
})
afterAll(() => { globalThis.fetch = originalFetch })

function filesBelow(directory: string): string[] {
  if (!existsSync(join(root, directory))) return []
  const output: string[] = []
  for (const name of readdirSync(join(root, directory))) {
    const absolute = join(root, directory, name)
    if (statSync(absolute).isDirectory()) output.push(...filesBelow(relative(root, absolute)))
    else output.push(relative(root, absolute).replaceAll("\\", "/"))
  }
  return output
}

describe("Shift4 final local consolidation", () => {
  it("repairs the build at the supported WalletConnect subpath without adding x402 dependencies", () => {
    expect(source("lib/wagmi.ts")).toContain('from "wagmi/connectors/walletConnect"')
    expect(source("lib/wagmi.ts")).not.toContain('from "wagmi/connectors"')
    const packageJson = JSON.parse(source("package.json")) as { dependencies: Record<string, string> }
    expect(Object.keys(packageJson.dependencies).filter((name) => name.startsWith("@x402/"))).toEqual([])
    expect(source("app/api/help/assistant/context-debug/route.ts")).not.toContain("export function derivePosMethodDebugFlags")
  })

  it("runs deterministic Engine fixtures with full internal checkout, retail, onboarding, and evidence state", async () => {
    const first = await runShift4CertificationFixture({ channel: "all" })
    const second = await runShift4CertificationFixture({ channel: "all" })
    expect(first.cases).toHaveLength(49)
    expect(first.providerRequestsSent).toBe(0)
    expect(first.fixtureState.checkout.states).toHaveLength(14)
    expect(first.fixtureState.checkout.consumption).toEqual(expect.objectContaining({ firstCallback: "consumed_now", duplicateCallback: "already_consumed" }))
    expect(first.fixtureState.retail.states).toHaveLength(16)
    expect(first.fixtureState.retail.maximumInactivityMs).toBe(60_000)
    expect(first.fixtureState.retail.engineResults.map((value) => value.outcome)).toEqual(["approved", "declined", "partial_approval", "referral", "unknown"])
    expect(first.fixtureState.onboarding.progression).toEqual(["not_started", "application_started", "submitted", "received", "under_review", "more_information_required", "approved"])
    expect(first.fixtureState.structuredEmail).toEqual(expect.objectContaining({ attachmentContentPersisted: false, realMailboxAccessed: false }))
    expect(normalizeShift4CertificationEvidence(first)).toEqual(normalizeShift4CertificationEvidence(second))
    expect(first.runId).toBe(second.runId)
    expect(first.manifestHash).toBe(second.manifestHash)
    expect(serializeShift4CertificationEvidence(first, "json")).not.toMatch(/synthetic-opaque-card-token/)
  })

  it("mounts fixture components only in the admin console and never calls a simulator from React", () => {
    const dashboard = source("app/dashboard/admin/shift4/page.tsx")
    expect(dashboard).toContain("Shift4HostedCheckoutPanel")
    expect(dashboard).toContain("Shift4RetailTerminalPanel")
    expect(dashboard).toContain("Run one case")
    expect(dashboard).toContain("Run workflow")
    expect(dashboard).toContain("providerRequestsSent")
    expect(dashboard).not.toMatch(/CommerceEngineSimulator|providers\/shift4|engine\/shift4/)
  })

  it("records every Shift4 route in the route matrix and enforces service boundaries", () => {
    const matrix = source("docs/architecture/shift4-route-matrix.md")
    const routeFiles = filesBelow("app/api").filter((path) => /(?:^|\/)shift4(?:\/|$)/.test(path) && path.endsWith("route.ts"))
    for (const routeFile of routeFiles) {
      const url = `/${routeFile.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`
      expect(matrix, routeFile).toContain(url)
      const routeSource = source(routeFile)
      if (routeFile.includes("/admin/shift4/")) expect(routeSource).toContain("requireAdminFromRequest")
      if (routeFile.includes("/internal/shift4/")) expect(routeSource).toContain("requireMerchantIdFromRequest")
      if (routeFile.includes("/admin/shift4/") || routeFile.includes("/internal/shift4/")) {
        expect(routeSource).toMatch(/shift4Success/)
        expect(routeSource).toMatch(/shift4Error/)
      }
    }
    const fixtureRoute = source("app/api/admin/shift4/certification/route.ts")
    expect(fixtureRoute).toContain('body.mode === "fixture"')
    expect(fixtureRoute).toContain("certification_external_blocker")
    for (const routeFile of routeFiles.filter((path) => !path.includes("/admin/shift4/certification/"))) expect(source(routeFile)).not.toContain("Shift4CommerceEngineSimulator")
  })

  it("classifies every Shift4 runtime root and documents intentional blocked adapters", () => {
    const inventory = source("docs/architecture/shift4-reachability-inventory.md")
    for (const path of ["engine/shift4/", "providers/shift4/", "app/api/admin/shift4/", "app/api/internal/shift4/", "scripts/shift4-certification/", "scripts/shift4-database/", "artifacts/shift4-database/"]) expect(inventory).toContain(path)
    expect(inventory).toContain("cardOnFileVault.ts")
    expect(inventory).toContain("phase3Contracts.ts")
    expect(inventory).toContain("No accidental duplicate execution implementation remains")
  })

  it("redacts deeply nested credential, card, authorization, applicant, bank, and transport fields", () => {
    const dangerousKeys = ["accessToken", "authToken", "clientGuid", "serviceRoleKey", "authorizationCode", "manualAuthorizationCode", "cardToken", "token", "pan", "cardNumber", "cvv", "csc", "pin", "pinBlock", "track1", "track2", "rawPayload", "requestBody", "responseBody", "headers", "applicationBody", "taxId", "ssn", "bankAccount", "routingNumber", "attachmentContent", "voiceCenterAccountNumber"]
    const sentinels = ["SECRET_SENTINEL_001", "CARD_TOKEN_SENTINEL_002", "PERSONAL_DATA_SENTINEL_003"]
    const nested = Object.fromEntries(dangerousKeys.map((key, index) => [key, { nested: [sentinels[index % sentinels.length], { deeper: sentinels[(index + 1) % sentinels.length] }] }]))
    const redacted = JSON.stringify(redactShift4Payload({ paymentId: "payment-safe", attemptId: "attempt-safe", invoice: "invoice-safe", correlationId: "correlation-safe", nested }))
    const safeLog = JSON.stringify(safeShift4LogFields({ paymentId: "payment-safe", attemptId: "attempt-safe", invoice: "invoice-safe", correlationId: "correlation-safe", ...nested, safeStatusReason: sentinels[0] }))
    for (const sentinel of sentinels) { expect(redacted).not.toContain(sentinel); expect(safeLog).not.toContain(sentinel) }
    expect(redacted).toContain("payment-safe")
    expect(safeLog).toContain("attempt-safe")
  })

  it("regenerates the seven-file database package deterministically and binds manifest hashes to migration bytes", () => {
    const run = () => execFileSync(process.execPath, ["scripts/shift4-database/release.mjs"], { cwd: root, encoding: "utf8" }).trim()
    const firstOutput = run()
    const artifactNames = ["00-manifest.json", "01-preflight.sql", "02-apply-order.txt", "03-postflight.sql", "04-smoke-tests.sql", "05-containment.sql", "06-operator-checklist.md"]
    const firstHashes = Object.fromEntries(artifactNames.map((name) => [name, hash(readFileSync(join(root, "artifacts/shift4-database", name)))]))
    const secondOutput = run()
    const secondHashes = Object.fromEntries(artifactNames.map((name) => [name, hash(readFileSync(join(root, "artifacts/shift4-database", name)))]))
    expect(secondHashes).toEqual(firstHashes)
    expect(JSON.parse(firstOutput)).toEqual(JSON.parse(secondOutput))
    const manifest = JSON.parse(source("artifacts/shift4-database/00-manifest.json")) as { validation: string; runtimeStatus: string; contactedDatabase: boolean; migrations: Array<{ path: string; sha256: string }> }
    expect(manifest).toEqual(expect.objectContaining({ validation: "static source validation only", runtimeStatus: "not_executed", contactedDatabase: false }))
    for (const migration of manifest.migrations) expect(migration.sha256).toBe(hash(readFileSync(join(root, migration.path))))
    expect(source("artifacts/shift4-database/04-smoke-tests.sql")).toMatch(/BEGIN;[\s\S]*ROLLBACK;/)
  })

  it("keeps sentinel values out of dashboard source, generated reports, and database artifacts", () => {
    const corpus = [
      source("app/dashboard/admin/shift4/page.tsx"),
      ...filesBelow("artifacts/shift4-database").map(source),
      ...filesBelow("artifacts/shift4-certification").filter((path) => /report-.*\.(json|csv|md)$/.test(path)).slice(-6).map(source),
    ].join("\n")
    expect(corpus).not.toMatch(/SECRET_SENTINEL_001|CARD_TOKEN_SENTINEL_002|PERSONAL_DATA_SENTINEL_003/)
  })
})
