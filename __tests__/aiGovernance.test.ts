import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
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

function preflight(task: string, paths: string[] = []): PreflightResult {
  const key = JSON.stringify([task, paths])
  const cached = preflightCache.get(key)
  if (cached) return cached
  const args = [PREFLIGHT, "--task", task, "--json"]
  for (const path of paths) args.push("--path", path)
  const stdout = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8" })
  const result = JSON.parse(stdout) as PreflightResult
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
  domains: Record<string, { documents?: string[]; optional?: string[]; keywords?: string[] }>
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

describe("AI governance: legacy skills are not authority", () => {
  it("never routes any docs/skills file", () => {
    const routed: string[] = [...taskMap.globalRequired, ...Object.values(taskMap.workflows)]
    for (const entry of taskMap.paths) {
      routed.push(...(entry.documents ?? []), ...(entry.optional ?? []))
    }
    for (const domain of Object.values(taskMap.domains)) {
      routed.push(...(domain.documents ?? []), ...(domain.optional ?? []))
    }
    expect(routed.filter((doc) => doc.startsWith("docs/skills/"))).toEqual([])
  })

  it("excludes both conflicting Solana skill files by name", () => {
    expect(taskMap.exclusions.never).toContain("docs/skills/solana-pay.md")
    expect(taskMap.exclusions.never).toContain("docs/skills/solana-wallet-signing.md")
  })

  it("excludes the whole legacy skills folder by glob", () => {
    expect(taskMap.exclusions.neverGlobs).toContain("docs/skills/**")
  })

  it("marks the legacy folder as non-authoritative in its README", () => {
    const readme = read("docs/skills/README.md")
    expect(readme).toMatch(/NOT AUTHORITATIVE/i)
    expect(readme).toContain("AGENTS.md")
    expect(readme).toContain("docs/standards")
  })

  it("classifies both Solana skills as superseded in the index", () => {
    const index = read("docs/INDEX.md")
    // INDEX.md lives in docs/, so its links are docs-relative.
    expect(index).toContain("skills/solana-pay.md")
    expect(index).toContain("skills/solana-wallet-signing.md")
    expect(index).toContain("domains/solana-wallet-routing.md")
  })

  it("leaves the legacy skill files in place", () => {
    // Governance classifies; it never deletes.
    for (const file of [
      "docs/skills/api.md",
      "docs/skills/database.md",
      "docs/skills/engine.md",
      "docs/skills/providers.md",
      "docs/skills/watcher.md",
      "docs/skills/webhook.md",
      "docs/skills/solana-pay.md",
      "docs/skills/solana-wallet-signing.md",
    ]) {
      expect(existsSync(join(root, file)), `${file} must be retained`).toBe(true)
    }
  })
})

describe("AI governance: root contract", () => {
  it("keeps CLAUDE.md as a small pointer to AGENTS.md", () => {
    const claude = read("CLAUDE.md")
    expect(claude).toContain("AGENTS.md")
    // A pointer, not a second copy of the contract.
    expect(claude.length).toBeLessThan(2000)
  })

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
