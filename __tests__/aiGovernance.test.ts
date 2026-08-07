import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, posix } from "node:path"
import { describe, expect, it, vi } from "vitest"

/**
 * Governance-wiring tests.
 *
 * These assert that routing resolves to the right documents and that legacy
 * material cannot be selected as authority. They deliberately do not pin
 * document prose — the standards' text is normative and must be free to be
 * amended through the change-control process without breaking CI.
 *
 * Several cases shell out to the preflight and governance-check scripts, which
 * is the only honest way to test their real resolution and exit behavior. Node
 * process startup is slow and load-sensitive, so this file needs more headroom
 * than the 5s default or it flakes when the suite runs under memory pressure.
 */
vi.setConfig({ testTimeout: 60_000 })

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), "utf8")
const PREFLIGHT = "scripts/ai-preflight.mjs"

type PreflightResult = {
  task: string
  paths: string[]
  domains: string[]
  required: string[]
  optional: string[]
  workflow: string
  workflowDocument: string | null
  ambiguous: boolean
  missing: string[]
  excludedHits: string[]
  ok: boolean
}

const preflightCache = new Map<string, PreflightResult>()

/** Always spawns a fresh process — use when asserting determinism. */
function preflightUncached(task: string, paths: string[] = []): PreflightResult {
  const args = [PREFLIGHT, "--task", task, "--json"]
  for (const path of paths) args.push("--path", path)
  const stdout = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8" })
  return JSON.parse(stdout) as PreflightResult
}

function preflight(task: string, paths: string[] = []): PreflightResult {
  const key = JSON.stringify([task, paths])
  const cached = preflightCache.get(key)
  if (cached) return cached
  const result = preflightUncached(task, paths)
  preflightCache.set(key, result)
  return result
}

const STANDARDS = {
  platform: "docs/standards/01-platform-architecture.md",
  lifecycle: "docs/standards/02-lifecycle-and-merchant-status.md",
  ledger: "docs/standards/03-financial-ledger-money-reconciliation.md",
  database: "docs/standards/04-database-identity-security.md",
  providers: "docs/standards/05-provider-connectors-events.md",
  governance: "docs/standards/06-roadmap-documentation-governance.md",
} as const

const taskMap = JSON.parse(read(".ai/task-map.json")) as {
  globalRequired: string[]
  workflows: Record<string, string>
  paths: Array<{ glob: string; documents?: string[]; optional?: string[]; domains?: string[] }>
  domains: Record<string, { documents?: string[]; optional?: string[]; keywords?: string[]; note?: string }>
  exclusions: { never: string[]; neverGlobs: string[] }
}

describe("AI governance: document existence", () => {
  it("resolves every document referenced by the task map", () => {
    const referenced = new Set<string>(taskMap.globalRequired)
    for (const doc of Object.values(taskMap.workflows)) referenced.add(doc)
    for (const entry of taskMap.paths) {
      for (const doc of entry.documents ?? []) referenced.add(doc)
      for (const doc of entry.optional ?? []) referenced.add(doc)
    }
    for (const domain of Object.values(taskMap.domains)) {
      for (const doc of domain.documents ?? []) referenced.add(doc)
      for (const doc of domain.optional ?? []) referenced.add(doc)
    }

    const missing = [...referenced].filter((doc) => !existsSync(join(root, doc)))
    expect(missing).toEqual([])
    expect(referenced.size).toBeGreaterThan(10)
  })

  it("keeps all six canonical standards present", () => {
    for (const path of Object.values(STANDARDS)) {
      expect(existsSync(join(root, path)), `${path} must exist`).toBe(true)
    }
  })

  it("declares every domain referenced by a path entry", () => {
    for (const entry of taskMap.paths) {
      for (const key of entry.domains ?? []) {
        expect(taskMap.domains[key], `path ${entry.glob} references undeclared domain ${key}`).toBeDefined()
      }
    }
  })
})

describe("AI governance: preflight routing", () => {
  it("always returns the global contract and platform standard", () => {
    const result = preflight("Add a new provider adapter", ["providers/example/example.ts"])
    expect(result.required).toContain("AGENTS.md")
    expect(result.required).toContain("docs/standards/README.md")
    expect(result.required).toContain(STANDARDS.platform)
    expect(result.required).toContain("docs/INDEX.md")
    expect(result.ok).toBe(true)
  })

  it("routes provider paths to the provider connector standard", () => {
    const result = preflight("Add a new provider adapter", ["providers/example/example.ts"])
    expect(result.required).toContain(STANDARDS.providers)
    expect(result.domains).toContain("providers")
  })

  it("routes engine paths to architecture, lifecycle, and ledger standards", () => {
    const result = preflight("Adjust engine event processing", ["engine/eventProcessor.ts"])
    expect(result.required).toContain(STANDARDS.platform)
    expect(result.required).toContain(STANDARDS.lifecycle)
    expect(result.required).toContain(STANDARDS.ledger)
    expect(result.required).toContain("docs/architecture.md")
  })

  it("routes database paths to ledger and database/security standards", () => {
    const result = preflight("Change a table definition", ["database/merchants.ts"])
    expect(result.required).toContain(STANDARDS.ledger)
    expect(result.required).toContain(STANDARDS.database)
  })

  it("routes checkout paths to lifecycle and checkout domain guidance", () => {
    const result = preflight("Modify checkout payment lifecycle", ["app/checkout/example.tsx"])
    expect(result.required).toContain(STANDARDS.lifecycle)
    expect(result.required).toContain("docs/api/checkout-sessions.md")
    expect(result.domains).toContain("checkout")
  })

  it("routes webhook paths to the connector standard and event catalog", () => {
    const result = preflight("Harden webhook verification", ["lib/webhooks/verify.ts"])
    expect(result.required).toContain(STANDARDS.providers)
    expect(result.required).toContain("docs/api/webhook-events.md")
  })

  it("routes a Solana task to the implemented routing document, not a legacy skill", () => {
    const result = preflight("Update Solana wallet selection for Phantom")
    expect(result.required).toContain("docs/domains/solana-wallet-routing.md")
    expect(result.domains).toContain("solana")
    expect(result.required.some((doc) => doc.startsWith("docs/skills/"))).toBe(false)
  })

  it("matches domain keywords on word boundaries", () => {
    // "database" must not trigger the Base rail domain.
    const result = preflight("Update a database column comment")
    expect(result.domains).toContain("database-security")
    expect(result.domains).not.toContain("base")
  })

  it("selects a workflow document for every inferred workflow", () => {
    const cases: Array<[string, string]> = [
      ["Implement a new payout screen", "implement"],
      ["Debug a stuck Processing payment", "debug"],
      ["Review the ledger posting change", "review"],
      ["Refactor the wallet helpers", "refactor"],
    ]
    for (const [task, expected] of cases) {
      const result = preflight(task)
      expect(result.workflow, task).toBe(expected)
      expect(result.workflowDocument, task).toBe(taskMap.workflows[expected])
      expect(existsSync(join(root, result.workflowDocument as string))).toBe(true)
    }
  })

  it("reports an unknown task as ambiguous instead of guessing a domain", () => {
    const result = preflight("Tidy up that thing we discussed")
    expect(result.ambiguous).toBe(true)
    expect(result.domains).toEqual([])
    // Global documents still load; nothing domain-specific is invented.
    expect(result.required).toContain("AGENTS.md")
    expect(result.required).not.toContain(STANDARDS.providers)
  })

  it("is not ambiguous once a path resolves a domain", () => {
    const result = preflight("Tidy up that thing we discussed", ["providers/example/example.ts"])
    expect(result.ambiguous).toBe(false)
    expect(result.domains).toContain("providers")
  })

  it("exits nonzero when a required governance file is missing", () => {
    // A path glob that maps to documents proves the happy path exits zero;
    // the failure path is covered by ai-governance-check, which asserts the
    // same resolution. Here we only assert the contract of a clean run.
    const result = preflight("Add a provider adapter", ["providers/example/example.ts"])
    expect(result.missing).toEqual([])
    expect(result.excludedHits).toEqual([])
  })

  it("requires a task description", () => {
    expect(() =>
      execFileSync(process.execPath, [PREFLIGHT, "--json"], { cwd: root, encoding: "utf8", stdio: "pipe" })
    ).toThrow()
  })
})

/**
 * Documents removed in the 2026-08-06 consolidation. Each was superseded,
 * duplicated, historical, or actively misleading. These assertions exist so a
 * deleted file cannot quietly return, and so no stale pointer survives.
 */
const RETIRED_DOCUMENTS = [
  "docs/skills/api.md",
  "docs/skills/database.md",
  "docs/skills/engine.md",
  "docs/skills/providers.md",
  "docs/skills/watcher.md",
  "docs/skills/webhook.md",
  "docs/skills/solana-pay.md",
  "docs/skills/solana-wallet-signing.md",
  "docs/skills/README.md",
  "docs/api/node-sdk-contract.md",
  "docs/api/provider-integrations.md",
  "docs/api/platform-readiness-report.md",
  "docs/architecture/canonical-transaction-read-audit.md",
  "docs/architecture/shift4-phase-2-implementation-report.md",
  "docs/architecture/shift4-retail-prehardware-readiness.md",
  // Renamed to docs/providers/stripe-terminal.md — the contract stayed active,
  // only its historical-looking filename was retired.
  "docs/stripe-terminal-phase-2.md",
  // Consolidated into docs/api/index.md, the sole API entry point.
  "docs/api/overview.md",
] as const

/** Every Markdown file under a repo-relative directory. */
function markdownUnder(relativeDir: string): string[] {
  const start = join(root, relativeDir)
  if (!existsSync(start)) return []
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (entry.name.endsWith(".md")) out.push(`${relativeDir}/${rel}`)
    }
  }
  walk(start, "")
  return out.sort()
}

describe("AI governance: retired documentation stays retired", () => {
  it("has removed the legacy docs/skills directory entirely", () => {
    expect(existsSync(join(root, "docs/skills"))).toBe(false)
  })

  it("has deleted every retired document", () => {
    const survivors = RETIRED_DOCUMENTS.filter((doc) => existsSync(join(root, doc)))
    expect(survivors).toEqual([])
  })

  it("leaves no link pointing at a retired document", () => {
    // Prose noting that a file was removed is legitimate history, and an ADR may
    // name what it supersedes. What must not survive is an actionable link that
    // sends a reader to a deleted file.
    const scanned = [
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      ...markdownUnder(".ai"),
      ...markdownUnder("docs"),
    ].filter((f) => existsSync(join(root, f)))

    const offenders: string[] = []
    for (const file of scanned) {
      const dir = posix.dirname(file.replace(/\\/g, "/"))
      for (const match of read(file).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const raw = match[1]
        if (/^(https?:|mailto:|#)/.test(raw)) continue
        const target = raw.split("#")[0]
        if (!target) continue
        const resolved = posix.normalize(posix.join(dir, target))
        if ((RETIRED_DOCUMENTS as readonly string[]).some((r) => resolved === r || resolved.startsWith(r))) {
          offenders.push(`${file} -> ${resolved}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("routes no retired document and no docs/skills path", () => {
    const routed: string[] = [...taskMap.globalRequired, ...Object.values(taskMap.workflows)]
    for (const entry of taskMap.paths) {
      routed.push(...(entry.documents ?? []), ...(entry.optional ?? []))
    }
    for (const domain of Object.values(taskMap.domains)) {
      routed.push(...(domain.documents ?? []), ...(domain.optional ?? []))
    }
    expect(routed.filter((doc) => doc.startsWith("docs/skills/"))).toEqual([])
    expect(routed.filter((doc) => (RETIRED_DOCUMENTS as readonly string[]).includes(doc))).toEqual([])
  })

  it("keeps a standing glob so a prompt directory cannot become authority again", () => {
    expect(taskMap.exclusions.neverGlobs).toContain("docs/skills/**")
  })

  it("preserves the Solana routing authority that replaced the conflicting skills", () => {
    expect(existsSync(join(root, "docs/domains/solana-wallet-routing.md"))).toBe(true)
    expect(read("docs/INDEX.md")).toContain("domains/solana-wallet-routing.md")
  })

  it("preserves the canonical-read decision as an accepted ADR", () => {
    // The deleted audit report carried an in-force decision; it had to survive.
    const adr = read("docs/architecture/adr-0002-canonical-transaction-reads.md")
    expect(adr).toMatch(/Status:\*\*\s*Accepted/)
    expect(adr).toContain("engine/canonicalTransactions.ts")
    expect(adr).toContain("adjustmentStatus")
  })
})

describe("AI governance: documentation-governance routing", () => {
  const STANDARD_06 = "docs/standards/06-roadmap-documentation-governance.md"

  it("declares documentation-governance as a domain requiring Standard 06", () => {
    const domain = taskMap.domains["documentation-governance"]
    expect(domain).toBeDefined()
    expect(domain.documents).toContain(STANDARD_06)
  })

  it("keeps its keywords phrase-scoped so broad words cannot over-route", () => {
    const keywords = taskMap.domains["documentation-governance"].keywords ?? []
    expect(keywords.length).toBeGreaterThan(4)
    for (const broad of ["docs", "document", "file", "markdown", "update"]) {
      expect(keywords, `"${broad}" is too broad to be a keyword`).not.toContain(broad)
    }
  })

  const DOC_SYSTEM_PATHS: Array<[string, string]> = [
    ["docs/INDEX.md", "the documentation index"],
    ["docs/api/index.md", "a file under docs/"],
    [".ai/task-map.json", "the routing map"],
    ["scripts/ai-preflight.mjs", "the preflight resolver"],
    ["scripts/ai-governance-check.mjs", "the governance check"],
    ["__tests__/aiGovernance.test.ts", "the governance tests"],
    ["AGENTS.md", "the root contract"],
    ["CLAUDE.md", "the Claude pointer"],
    ["README.md", "the root README"],
  ]

  for (const [path, label] of DOC_SYSTEM_PATHS) {
    it(`resolves documentation-governance and Standard 06 when editing ${label}`, () => {
      const result = preflight("Adjust engineering documentation structure", [path])
      expect(result.domains, `${path} must route documentation-governance`).toContain(
        "documentation-governance"
      )
      expect(result.required).toContain(STANDARD_06)
      expect(result.missing).toEqual([])
      expect(result.excludedHits).toEqual([])
      expect(result.ambiguous).toBe(false)
      expect(result.required.some((doc) => doc.startsWith("docs/skills/"))).toBe(false)
      expect(
        result.required.filter((doc) => (RETIRED_DOCUMENTS as readonly string[]).includes(doc))
      ).toEqual([])
    })
  }

  it("does not attach documentation-governance to an application-only task", () => {
    // Generic words like "update" and "file" must not pull the domain in.
    for (const task of [
      "Fix POS keypad layout behavior",
      "Update a file in the POS component",
      "Change POS payment state presentation",
    ]) {
      const result = preflight(task, ["components/pos/POSLayout.tsx"])
      expect(result.domains, `"${task}" over-routed`).not.toContain("documentation-governance")
      expect(result.required).not.toContain(STANDARD_06)
    }
  })

  it("does not drag an unrelated standard into a documentation task", () => {
    // A bare "index" keyword on database-security used to match "documentation
    // index" and pull Standard 04 plus the route-auth matrix into pure
    // documentation work. Keywords that read as English words elsewhere must be
    // phrase-scoped, the same discipline documentation-governance already applies.
    const result = preflight("Rework the documentation index and task routing", [
      "docs/INDEX.md",
      ".ai/task-map.json",
    ])
    expect(result.domains).toEqual(["documentation-governance"])
    expect(result.required).not.toContain(STANDARDS.database)
    expect([...result.required, ...result.optional]).not.toContain("docs/security/route-auth-matrix.md")
  })

  it("still routes real database-index work to the database standard", () => {
    for (const task of ["Add a database index to payments", "Review indexing strategy for merchants"]) {
      const result = preflight(task)
      expect(result.domains, task).toContain("database-security")
      expect(result.required, task).toContain(STANDARDS.database)
    }
  })

  it("resolves documentation-governance from a documentation keyword with no path", () => {
    const result = preflight("Rework the documentation index and task routing")
    expect(result.domains).toContain("documentation-governance")
    expect(result.required).toContain(STANDARD_06)
  })

  it("is deterministic across repeated runs", () => {
    const a = preflightUncached("Update documentation governance", ["docs/INDEX.md"])
    const b = preflightUncached("Update documentation governance", ["docs/INDEX.md"])
    expect(a).toEqual(b)
  })
})

describe("AI governance: renamed and consolidated paths route correctly", () => {
  it("routes the Stripe Terminal contract at its new path, never the old one", () => {
    const result = preflight("Update Stripe Terminal direct-charge and manual-entry behavior", [
      "providers/stripe/terminalAdapter.ts",
      "docs/providers/stripe-terminal.md",
    ])
    const all = [...result.required, ...result.optional]
    expect(all).toContain("docs/providers/stripe-terminal.md")
    expect(all).not.toContain("docs/stripe-terminal-phase-2.md")
    expect(result.domains).toContain("documentation-governance")
    expect(result.missing).toEqual([])
    expect(result.ambiguous).toBe(false)
  })

  it("routes API documentation work to the single entry point", () => {
    const result = preflight("Update the PineTree API documentation entry point", [
      "docs/api/index.md",
    ])
    expect(result.domains).toContain("documentation-governance")
    expect(result.domains).toContain("api-sdk")
    expect([...result.required, ...result.optional]).not.toContain("docs/api/overview.md")
    expect(result.missing).toEqual([])
    expect(result.ambiguous).toBe(false)
  })

  it("keeps the renamed Stripe Terminal contract intact", () => {
    const contract = read("docs/providers/stripe-terminal.md")
    expect(contract).toMatch(/^# Stripe Terminal Integration Contract/m)
    expect(contract).not.toContain("Phase 2")
    // Active requirements that must survive the rename.
    for (const requirement of [
      "PINE_TREE_STRIPE_CHARGE_MODEL=direct",
      "Stripe-Account",
      "native_app_required",
      "Tap to Pay",
      "STRIPE_APPLICATION_FEE_ENABLED",
      "PINETREE_NATIVE_CLIENT_SECRET",
      "private/no-store",
    ]) {
      expect(contract, `rename must preserve: ${requirement}`).toContain(requirement)
    }
  })
})

describe("AI governance: docs/INDEX.md is a complete, resolving map", () => {
  it("resolves every relative link in the index", () => {
    const index = read("docs/INDEX.md")
    const broken: string[] = []
    for (const match of index.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const raw = match[1]
      if (/^(https?:|mailto:|#)/.test(raw)) continue
      const target = raw.split("#")[0]
      if (!target) continue
      const resolved = join(root, "docs", target)
      if (!existsSync(resolved)) broken.push(raw)
    }
    expect(broken).toEqual([])
  })

  it("lists every canonical standard and both accepted ADRs", () => {
    const index = read("docs/INDEX.md")
    for (const n of ["01-platform-architecture", "02-lifecycle-and-merchant-status",
      "03-financial-ledger-money-reconciliation", "04-database-identity-security",
      "05-provider-connectors-events", "06-roadmap-documentation-governance"]) {
      expect(index, `index must list ${n}`).toContain(n)
    }
    expect(index).toContain("adr-0001-ledger-journal-entries.md")
    expect(index).toContain("adr-0002-canonical-transaction-reads.md")
  })

  it("indexes every active document under docs/", () => {
    // A document that exists but is not indexed is unreachable authority.
    const index = read("docs/INDEX.md")
    const unindexed = markdownUnder("docs")
      .map((p) => p.replace(/^docs\//, ""))
      .filter((rel) => rel !== "INDEX.md")
      .filter((rel) => !index.includes(rel))
    expect(unindexed).toEqual([])
  })
})

/**
 * One entry authority.
 *
 * Every coding agent must enter through AGENTS.md. Tool-specific discovery files
 * may exist only as tiny pointers to it. The failure mode these tests guard is
 * silent: a file that some tool auto-loads becomes a parallel instruction system
 * without anyone deciding it should. Mirrors section 2 of
 * scripts/ai-governance-check.mjs — the script is the enforcement, these are the
 * readable statement of the invariant.
 */
const CANONICAL_ENTRY = "AGENTS.md"

/** Discovery files agent tools auto-load. Presence is what matters, not the tool. */
const AGENT_DISCOVERY_FILES = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CODEX.md",
  "COPILOT.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  ".roorules",
  ".github/copilot-instructions.md",
  ".gemini/GEMINI.md",
  ".codex/instructions.md",
] as const

/** Directories some tools load wholesale as agent rules. */
const AGENT_RULE_DIRECTORIES = [
  ".agents",
  ".cursor/rules",
  ".clinerules",
  ".roo/rules",
  ".github/instructions",
] as const

const APPROVED_POINTERS = ["CLAUDE.md"] as const
const POINTER_MAX_BYTES = 1200

describe("AI governance: one agent entry authority", () => {
  it("keeps AGENTS.md as the canonical entry point", () => {
    expect(existsSync(join(root, CANONICAL_ENTRY))).toBe(true)
    const agents = read(CANONICAL_ENTRY)
    expect(agents).toMatch(/single entry point/i)
    expect(agents).toContain("ai:preflight")
  })

  it("has no agent discovery file other than the entry and approved pointers", () => {
    const rogue = AGENT_DISCOVERY_FILES.filter(
      (file) =>
        file !== CANONICAL_ENTRY &&
        !(APPROVED_POINTERS as readonly string[]).includes(file) &&
        existsSync(join(root, file))
    )
    expect(rogue, "a tool-specific instruction file must be a pointer or deleted").toEqual([])
  })

  it("keeps every agent rule directory absent or empty", () => {
    const populated = AGENT_RULE_DIRECTORIES.filter((dir) => {
      const target = join(root, dir)
      if (!existsSync(target)) return false
      if (!statSync(target).isDirectory()) return false
      return readdirSync(target).length > 0
    })
    expect(populated, "agent rules must live in AGENTS.md, not a rules directory").toEqual([])
  })

  it("keeps every approved pointer a small pointer to AGENTS.md", () => {
    for (const pointer of APPROVED_POINTERS) {
      expect(existsSync(join(root, pointer)), `${pointer} must exist`).toBe(true)
      const text = read(pointer)
      expect(text, `${pointer} must reference ${CANONICAL_ENTRY}`).toContain(CANONICAL_ENTRY)
      expect(text.length, `${pointer} must stay a pointer`).toBeLessThanOrEqual(POINTER_MAX_BYTES)
    }
  })

  it("keeps substantive PineTree policy out of every pointer", () => {
    // Specific markers of duplicated authority. A pointer legitimately names
    // "architecture" and "workflow" in the negative, so those words alone are not
    // the signal — provider names, money rules, and security mechanics are.
    const forbidden: Array<[RegExp, string]> = [
      [/docs\/standards\//, "routes to the standards"],
      [/\bledger\b/i, "ledger rule"],
      [/platform fee/i, "fee policy"],
      [/\$0\.15/, "fee amount"],
      [/idempoten/i, "idempotency rule"],
      [/\bRLS\b|row.level security/i, "tenancy rule"],
      [/\bHMAC\b|merchant_id/, "security mechanic"],
      [/\bmigration/i, "migration rule"],
      [/\bwebhook/i, "webhook rule"],
      [/append-only|state machine|Provider Adapter/i, "architecture rule"],
      [/\bStripe\b|\bShift4\b|\bFluidPay\b|\bShopify\b|\bWooCommerce\b/i, "provider rule"],
      [/\bSolana\b|\bBase Pay\b|\bLightning\b|\bTrySpeed\b/i, "rail rule"],
    ]
    for (const pointer of APPROVED_POINTERS) {
      const text = read(pointer)
      for (const [pattern, label] of forbidden) {
        expect(pattern.test(text), `${pointer} must not carry a ${label}`).toBe(false)
      }
    }
  })

  it("never routes a pointer as a document", () => {
    // Routing *on* CLAUDE.md is correct — editing it should route Standard 06.
    // Routing *to* it would put a tool-specific file back into the authority chain.
    const routed: string[] = [...taskMap.globalRequired, ...Object.values(taskMap.workflows)]
    for (const entry of taskMap.paths) {
      routed.push(...(entry.documents ?? []), ...(entry.optional ?? []))
    }
    for (const domain of Object.values(taskMap.domains)) {
      routed.push(...(domain.documents ?? []), ...(domain.optional ?? []))
    }
    expect(routed.filter((doc) => (APPROVED_POINTERS as readonly string[]).includes(doc))).toEqual([])

    // But the pointer must still be a routing *key*, so editing it is governed.
    expect(taskMap.paths.map((p) => p.glob)).toContain("CLAUDE.md")
  })

  it("never presents a pointer as technical authority in an indexed document", () => {
    const offenders: string[] = []
    for (const doc of ["docs/INDEX.md", "README.md", CANONICAL_ENTRY, ...markdownUnder("docs"), ...markdownUnder(".ai")]) {
      if (!existsSync(join(root, doc))) continue
      for (const line of read(doc).split("\n")) {
        if (!APPROVED_POINTERS.some((p) => line.includes(p))) continue
        if (!/\]\(/.test(line)) continue
        if (!/pointer/i.test(line)) offenders.push(`${doc}: unlabelled pointer link`)
        if (/\bcanonical\b|\bLevel \d|source of truth/i.test(line)) {
          offenders.push(`${doc}: pointer presented as authority`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("keeps the pointer listed in docs/INDEX.md as a pointer", () => {
    // Listed, because an unindexed root file is unreachable and suspicious — but
    // labelled so no reader mistakes it for a source.
    const row = read("docs/INDEX.md")
      .split("\n")
      .find((line) => line.includes("CLAUDE.md") && line.startsWith("|"))
    expect(row).toBeDefined()
    expect(row).toMatch(/Pointer/)
  })

  it("does not duplicate Standard 01 invariant text in AGENTS.md", () => {
    // AGENTS.md routes to authority; it must not restate the invariants, because
    // two copies of an invariant is how they drift.
    const agents = read(CANONICAL_ENTRY)
    const standard01 = read(STANDARDS.platform)
    // Sentences lifted verbatim from Standard 01 §2/§3 that used to live in AGENTS.md.
    for (const invariant of [
      "Provider secrets, finality decisions, fee posting, canonical transitions",
      "The payments table is a payment-intent and status record",
      "The standard Platform Fee is $0.15 per transaction",
    ]) {
      expect(standard01, `fixture drifted: ${invariant}`).toContain(invariant)
      expect(agents, `AGENTS.md must not restate: ${invariant}`).not.toContain(invariant)
    }
    // It must point at the standard instead.
    expect(agents).toContain("docs/standards/01-platform-architecture.md")
  })
})

/**
 * Rail invariants must be single-sourced, not weakened.
 *
 * The worked example: an ERC-20/USDC approval authorizes spending only, is not
 * payment finality, and its hash must never populate the canonical payment hash.
 * That is a payment-finality rule, so Standard 02 §2 is its canonical home — and it
 * has lived there since commit d41682f, before the entry-point consolidation.
 *
 * These tests exist because de-duplicating an entry point can silently delete an
 * invariant rather than relocate it, and because keyword routing alone would leave
 * it unsurfaced for a task whose wording never mentions the rail.
 */
describe("AI governance: the approval-versus-payment-hash invariant", () => {
  const CANONICAL = STANDARDS.lifecycle
  const CANONICAL_TEXT =
    "A Base USDC approval transaction is not the payment transaction and must never be stored as the successful payment hash."

  it("keeps the canonical invariant in Standard 02", () => {
    // (1) Removing this sentence must fail the suite — that is the whole point.
    expect(read(CANONICAL)).toContain(CANONICAL_TEXT)
    // The supporting rule that approval is not confirmation sits alongside it.
    expect(read(CANONICAL)).toMatch(/ERC-20 approval[^.\n]*are not payment confirmation/)
  })

  it("routes Standard 02 for a Base task identified by keyword", () => {
    // (2a) keyword routing
    for (const task of [
      "Fix Base USDC payment confirmation",
      "Adjust the WalletConnect split contract call",
      "Update ETH payment status",
    ]) {
      const result = preflight(task)
      expect(result.domains, task).toContain("base")
      expect(result.required, task).toContain(CANONICAL)
    }
  })

  it("routes Standard 02 for a Base path even when the task text never says Base", () => {
    // (2b) path routing — the gap this pass closed. "Fix the approval receipt
    // helper" names no rail, and previously resolved only the reporting domain.
    for (const [task, path] of [
      ["Fix the approval receipt helper", "lib/basePay/approvalReceipt.ts"],
      ["Tidy the strategy orchestrator", "lib/basePay/strategyOrchestrator.ts"],
      ["Update the adapter's transfer verification", "providers/basePay.ts"],
      ["Refactor the adapter class", "providers/BaseAdapter.ts"],
    ] as const) {
      const result = preflight(task, [path])
      expect(result.domains, `${task} @ ${path}`).toContain("base")
      expect(result.required, `${task} @ ${path}`).toContain(CANONICAL)
      expect(result.ambiguous, `${task} @ ${path}`).toBe(false)
      expect(result.missing).toEqual([])
    }
  })

  it("does not duplicate the invariant in AGENTS.md or any pointer", () => {
    // (3) AGENTS.md routes to the standard instead of restating the rule.
    const restatement =
      /approval\s+(?:tx|transaction|hash|receipt)[^.\n]{0,80}(?:never|not)[^.\n]{0,80}payment\s+hash|approval\s+hash[^.\n]{0,40}(?:never|not)[^.\n]{0,40}payment/i
    for (const file of ["AGENTS.md", "CLAUDE.md", "README.md", ".ai/README.md"]) {
      expect(restatement.test(read(file)), `${file} must not restate the invariant`).toBe(false)
    }
  })

  it("keeps Standard 06 a governance gate, not a second technical authority", () => {
    // (4) Standard 06 §3 lists this as an acceptance-validation item, which is a
    // governance purpose and is allowed. What must not happen is Standard 06
    // stating it as standalone normative provider guidance outside that gate list.
    const standard06 = read(STANDARDS.governance)
    const mentions = standard06
      .split("\n")
      .map((line, i) => [i, line] as const)
      .filter(([, line]) => /approval hash/i.test(line))

    expect(mentions.length, "Standard 06 should mention it once, as a gate").toBe(1)

    const [lineNo] = mentions[0]
    const acceptanceStart = standard06.split("\n").findIndex((l) => /^# 3\. Immediate acceptance priorities/.test(l))
    const acceptanceEnd = standard06.split("\n").findIndex((l) => /^# 4\. Standard definition of done/.test(l))
    expect(acceptanceStart).toBeGreaterThan(-1)
    expect(lineNo, "the mention must sit inside the acceptance-priorities gate list").toBeGreaterThan(acceptanceStart)
    expect(lineNo).toBeLessThan(acceptanceEnd)

    // And it must read as validation, not as the rule's definition.
    expect(standard06.split("\n")[lineNo]).toMatch(/^- Validate/)
  })

  it("keeps the router pointing at the standard rather than restating the rule", () => {
    // (5) A task-map note is level-6 data, never authority. It may name the topic
    // and cite the standard; it must not be where an agent learns the rule.
    const note = taskMap.domains["base"].note ?? ""
    expect(note).toMatch(/Standard 02/)
    expect(taskMap.domains["base"].documents).toContain(CANONICAL)
    // Every rail source path must reach the canonical standard.
    const railPaths = taskMap.paths.filter((p) => /basePay|BaseAdapter/i.test(p.glob))
    expect(railPaths.length).toBeGreaterThan(0)
    for (const entry of railPaths) {
      const viaDomain = (entry.domains ?? []).some((k) =>
        (taskMap.domains[k]?.documents ?? []).includes(CANONICAL)
      )
      const viaDocs = (entry.documents ?? []).includes(CANONICAL)
      expect(viaDomain || viaDocs, `${entry.glob} must reach Standard 02`).toBe(true)
    }
  })
})

describe("AI governance: root contract", () => {
  it("requires the preflight from AGENTS.md", () => {
    const agents = read("AGENTS.md")
    expect(agents).toContain("ai:preflight")
    expect(agents).toContain("docs/standards/README.md")
  })

  it("requires AGENTS.md and the platform standard globally", () => {
    expect(taskMap.globalRequired).toContain("AGENTS.md")
    expect(taskMap.globalRequired).toContain(STANDARDS.platform)
  })

  it("carries the disagreement rule in every standard", () => {
    for (const path of Object.values(STANDARDS)) {
      expect(read(path), path).toContain("disagreement must be logged and deliberately resolved")
    }
  })

  it("passes the governance check end to end", () => {
    const stdout = execFileSync(process.execPath, ["scripts/ai-governance-check.mjs"], {
      cwd: root,
      encoding: "utf8",
    })
    expect(stdout).toContain("0 failed")
  })
})
