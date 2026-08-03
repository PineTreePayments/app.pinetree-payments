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
      // Internal routes derive identity from the verified session, never a body.
      // The credential-exchange and raw-readiness surfaces are operator tools
      // and use the stricter admin+email check instead of merchant auth.
      if (routeFile.includes("/internal/shift4/")) {
        expect(routeSource, routeFile).toMatch(
          /requireMerchantIdFromRequest|requireShift4OperatorFromRequest/
        )
      }
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
    expect(manifest).toEqual(expect.objectContaining({ validation: "static release-package validation; executable smoke SQL generated but not run locally", runtimeStatus: "not_executed", contactedDatabase: false }))
    for (const migration of manifest.migrations) expect(migration.sha256).toBe(hash(readFileSync(join(root, migration.path))))
    expect(source("artifacts/shift4-database/04-smoke-tests.sql")).toMatch(/BEGIN;[\s\S]*ROLLBACK;/)
    expect(source("artifacts/shift4-database/04-smoke-tests.sql")).toBe(source("scripts/shift4-database/smoke-tests.sql"))
  })

  it("tracks both forward corrections and generates fail-fast executable smoke coverage", () => {
    const privilegeMigrationPath = "database/migrations/20260802020000_harden_shift4_function_execute_privileges.sql"
    const aliasMigrationPath = "database/migrations/20260802030000_fix_ledger_posting_link_alias.sql"
    const migration = source(privilegeMigrationPath).toLowerCase()
    const aliasMigration = source(aliasMigrationPath).toLowerCase()
    const manifest = JSON.parse(source("artifacts/shift4-database/00-manifest.json")) as { migrations: Array<{ path: string; executionOrder: number }> }
    expect(manifest.migrations.map(({ path }) => path)).toEqual([
      "database/migrations/20260731163000_create_ledger_journal_foundation.sql",
      "database/migrations/20260731163100_create_shift4_payment_attempts.sql",
      "database/migrations/20260801160000_create_shift4_tokenization_sessions.sql",
      "database/migrations/20260801161000_create_shift4_onboarding_sessions.sql",
      privilegeMigrationPath,
      aliasMigrationPath,
    ])
    expect(manifest.migrations.at(-1)?.executionOrder).toBe(6)
    const deployedHashes = new Map([
      ["database/migrations/20260731163000_create_ledger_journal_foundation.sql", "3D38B541E31CF089AC504CB023B3A1C04311C1110D67A4C98E564345417616DF"],
      ["database/migrations/20260731163100_create_shift4_payment_attempts.sql", "3D2A838AA7A0F9F56CF3F4032D6B0DC6632BDA57D475029A41CC4D3605BA8F9E"],
      ["database/migrations/20260801160000_create_shift4_tokenization_sessions.sql", "5E0A6014A0801F503EEA73A7F84740907470D80B43A0B8BF14C6AB71677867FC"],
      ["database/migrations/20260801161000_create_shift4_onboarding_sessions.sql", "E208AD4D0677A6A6601586D399105E9309EBD2D021E6935DC2F66B79EB84E940"],
      [privilegeMigrationPath, "696F3CCFD8C41240F075FB41E9B80699A84C22511F5A6ECAAF640ED6540F6FDD"],
      [aliasMigrationPath, "50D24589CD9CA4DF7E41E32DEA794F702764AC45671C703074F443816DBF00B8"],
    ])
    for (const [path, expectedHash] of deployedHashes) expect(hash(readFileSync(join(root, path))), path).toBe(expectedHash)
    expect(migration).toMatch(/^--[\s\S]*\bbegin;/)
    expect(migration.trimEnd()).toMatch(/commit;$/)
    expect(migration).not.toMatch(/create\s+(?:or\s+replace\s+)?function|\b(?:insert|update|delete)\s+(?:into|public\.)/)
    expect(migration).toContain("notify pgrst, 'reload schema'")
    expect(aliasMigration).toMatch(/^begin;/)
    expect(aliasMigration.trimEnd()).toMatch(/commit;$/)
    expect(aliasMigration).toContain("create or replace function public.post_ledger_transaction(")
    expect(aliasMigration).toContain("from jsonb_array_elements(p_links) as link_item(value)")
    expect(aliasMigration).not.toMatch(/\bas\s+v_link\b/)
    expect(aliasMigration).not.toMatch(/\bv_link\s+jsonb\s*;/)
    expect(aliasMigration).toContain("owner to postgres")
    expect(aliasMigration).toContain("from public, anon, authenticated, service_role")
    expect(aliasMigration).toContain("to service_role")

    const helpers = [
      "ledger_account_identity_is_immutable",
      "shift4_tender_group_identity_is_immutable",
      "shift4_tender_group_is_undeletable",
    ]
    const rpcs = [
      "create_shift4_payment_attempt",
      "claim_due_shift4_payment_attempts",
      "apply_shift4_attempt_evidence",
      "release_shift4_attempt_lease",
    ]
    for (const name of [...helpers, ...rpcs]) {
      expect(migration).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\)\\s+from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role\\s*;`))
    }
    const grants = [...migration.matchAll(/grant\s+execute\s+on\s+function\s+public\.([a-z0-9_]+)\s*\([\s\S]*?\)\s+to\s+service_role\s*;/g)].map((match) => match[1])
    expect(grants).toEqual(rpcs)
    for (const helper of helpers) expect(migration).not.toMatch(new RegExp(`grant\\s+execute[\\s\\S]*?public\\.${helper}`))

    const ledgerMigration = source("database/migrations/20260731163000_create_ledger_journal_foundation.sql").toLowerCase()
    const attemptsMigration = source("database/migrations/20260731163100_create_shift4_payment_attempts.sql").toLowerCase()
    expect(ledgerMigration).toMatch(/revoke\s+all\s+on\s+function\s+public\.ledger_account_identity_is_immutable\(\)\s+from\s+public,\s*anon,\s*authenticated,\s*service_role/)
    for (const name of [...helpers.slice(1), ...rpcs]) expect(attemptsMigration).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}`))

    const smoke = source("artifacts/shift4-database/04-smoke-tests.sql")
    const executableSmoke = smoke.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ")
    for (const smokeCase of ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S09b", "S10", "S11", "S12", "S13", "S14", "S15", "S16", "S17", "S18", "S19"]) {
      expect(executableSmoke).toMatch(new RegExp(`raise\\s+notice\\s+'${smokeCase}\\b`, "i"))
    }
    expect(smoke).not.toMatch(/^\s*--\s*S(?:0[1-9]|1[0-9])\b/im)
    expect(executableSmoke).toMatch(/raise\s+exception/iu)
    expect(executableSmoke).not.toMatch(/00000000-0000-0000-0000-00000000000[1-4]/i)
    expect(executableSmoke).not.toMatch(/v_operator_confirms|operator configuration block/i)
    for (const identifier of ["v_merchant_id", "v_payment_a_id", "v_payment_b_id", "v_connection_id"]) {
      expect(executableSmoke).toMatch(new RegExp(`\\b${identifier}\\s+uuid\\s*:=\\s*gen_random_uuid\\(\\)`, "i"))
    }
    expect(executableSmoke).toContain("v_payment_a_id = v_payment_b_id")
    expect(executableSmoke).toMatch(/insert\s+into\s+public\.merchants\s*\(\s*id,\s*email,\s*business_name,\s*created_at\s*\)/i)
    expect(executableSmoke).not.toMatch(/\bm\.provider\b/i)
    expect(executableSmoke).toMatch(/insert\s+into\s+public\.merchant_providers\s*\(\s*id,\s*merchant_id,\s*provider,\s*enabled,\s*credentials,\s*created_at,\s*updated_at\s*\)\s*values\s*\(\s*v_connection_id,\s*v_merchant_id,\s*'shift4_rest',\s*true,/i)
    expect(executableSmoke).toContain("mp.provider='shift4_rest' AND mp.status='active' AND mp.enabled=true")
    expect(executableSmoke).toMatch(/insert\s+into\s+public\.payments\s*\(\s*id,\s*merchant_id,\s*subtotal_amount,\s*platform_fee,\s*total_amount,\s*merchant_amount,\s*pinetree_fee,\s*gross_amount/i)
    expect(executableSmoke).toMatch(/v_payment_a_id,\s*v_merchant_id,\s*200,\s*15,\s*215,\s*2\.00,\s*0\.15,\s*2\.15/)
    expect(executableSmoke).toMatch(/v_payment_b_id,\s*v_merchant_id,\s*300,\s*15,\s*315,\s*3\.00,\s*0\.15,\s*3\.15/)
    expect(executableSmoke).toContain("'merchantAmountMinor',200,'pinetreeFeeMinor',15,'grossAmountMinor',215")
    expect(executableSmoke).toContain("'merchantAmountMinor',300,'pinetreeFeeMinor',15,'grossAmountMinor',315")
    for (const payment of ["a", "b"]) {
      const row = `v_payment_${payment}`
      expect(executableSmoke).toContain(`${row}.subtotal_amount <> ${row}.merchant_amount * 100`)
      expect(executableSmoke).toContain(`${row}.platform_fee <> ${row}.pinetree_fee * 100`)
      expect(executableSmoke).toContain(`${row}.total_amount <> ${row}.gross_amount * 100`)
      expect(executableSmoke).toContain(`${row}.subtotal_amount + ${row}.platform_fee <> ${row}.total_amount`)
      expect(executableSmoke).toContain(`${row}.merchant_amount + ${row}.pinetree_fee <> ${row}.gross_amount`)
    }
    expect(executableSmoke).toContain("p.subtotal_amount=200 AND p.platform_fee=15 AND p.total_amount=215")
    expect(executableSmoke).toContain("p.subtotal_amount=300 AND p.platform_fee=15 AND p.total_amount=315")
    const outerBeginIndex = executableSmoke.toLowerCase().indexOf("begin;")
    expect(executableSmoke.toLowerCase().indexOf("insert into public.merchants")).toBeGreaterThan(outerBeginIndex)
    expect(executableSmoke).not.toMatch(/^\s*COMMIT\s*;/im)
    expect(executableSmoke).not.toMatch(/v_connection_[2-9]_id/i)
    expect(executableSmoke).not.toMatch(/two\s+(?:distinct\s+)?shift4_rest\s+connections/i)
    expect(executableSmoke).toContain("S06 nonexistent payment-event ledger-link rejection passed")
    expect(executableSmoke).toContain("S05 account/merchant mismatch was not rejected: %")
    expect(executableSmoke).toContain("S05 account and merchant mismatch passed")
    expect(executableSmoke).toContain("S19 payment and tender-group isolation passed")
    expect(executableSmoke).toContain("Final containment assertions passed for generated rollback-only fixtures")
    expect(executableSmoke).not.toMatch(/\B:(?:merchant_id|payment_id|connection_id)\b/i)
    expect(executableSmoke).not.toMatch(/\b(?:pg_net|net\.http|http_get|http_post|curl|fetch)\b|https?:\/\//i)
    expect(executableSmoke.trimEnd()).toMatch(/ROLLBACK;$/)

    const postflight = source("artifacts/shift4-database/03-postflight.sql")
    expect(postflight).toContain("pg_get_function_identity_arguments(p.oid)")
    expect(postflight).toContain("v_signature")
    expect(postflight).toContain("v_grantee")
    expect(postflight).toContain("public.%(%) grantee=%")
    expect(postflight).toContain("post_ledger_transaction owner must be postgres")
    expect(postflight).toContain("post_ledger_transaction must be SECURITY DEFINER")
    expect(postflight).toContain("post_ledger_transaction search_path must be pinned to public, pg_temp")
    expect(postflight).toContain("PUBLIC must not execute post_ledger_transaction")
    expect(postflight).toContain("Browser roles must not execute post_ledger_transaction")
    expect(postflight).toContain("service_role execute privilege missing for post_ledger_transaction")
    expect(postflight).not.toContain("THEN RAISE EXCEPTION 'Unexpected function EXECUTE privilege';")
  })

  it("emits one matching named, read-only postflight block without dashboard SQL", () => {
    const postflight = source("artifacts/shift4-database/03-postflight.sql")
    const dollarTags = [...postflight.matchAll(/\$[a-z_][a-z0-9_]*\$/gi)].map((match) => match[0])
    const executablePostflight = postflight
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--.*$/gm, " ")
      .replace(/'(?:''|[^'])*'/g, "''")

    expect(dollarTags).toEqual(["$postflight$", "$postflight$"])
    expect(postflight).toMatch(/^DO \$postflight\$\r?\nDECLARE/m)
    expect(postflight).toMatch(/END;\r?\n\$postflight\$;\r?\nSELECT/)
    expect(postflight).not.toContain("DO $$")
    expect(postflight).not.toMatch(/^\s*\$;\s*$/m)
    expect(postflight).not.toMatch(/Added by Supabase|ALTER\s+TABLE\s+v_name|dashboard\s+(?:session|user|date)|```/i)
    expect(postflight.trimEnd()).not.toMatch(/"$/)
    expect(executablePostflight).not.toMatch(/\b(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|NOTIFY)\b/i)

    for (const assertion of [
      "post_ledger_transaction owner must be postgres",
      "post_ledger_transaction must be SECURITY DEFINER",
      "post_ledger_transaction search_path must be pinned to public, pg_temp",
      "PUBLIC must not execute post_ledger_transaction",
      "Browser roles must not execute post_ledger_transaction",
      "service_role execute privilege missing for post_ledger_transaction",
    ]) expect(postflight).toContain(assertion)
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
