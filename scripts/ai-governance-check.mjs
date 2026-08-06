#!/usr/bin/env node
/**
 * PineTree AI governance check.
 *
 * Verifies that the governance system is wired correctly: the contract exists,
 * the six standards are present with their authority metadata, every task-map
 * reference resolves, nothing superseded is routed, and relative Markdown links
 * inside governance files point at real files.
 *
 * Read-only and offline. Never reads secrets, never writes, never uses network.
 *
 *   node scripts/ai-governance-check.mjs
 *
 * Exit codes: 0 all checks pass, 1 one or more failures.
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, resolve, posix } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const STANDARDS = [
  "docs/standards/01-platform-architecture.md",
  "docs/standards/02-lifecycle-and-merchant-status.md",
  "docs/standards/03-financial-ledger-money-reconciliation.md",
  "docs/standards/04-database-identity-security.md",
  "docs/standards/05-provider-connectors-events.md",
  "docs/standards/06-roadmap-documentation-governance.md"
]

const GOVERNANCE_LINK_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/INDEX.md",
  "docs/standards/README.md",
  ".ai/README.md",
  ".ai/workflows/implement.md",
  ".ai/workflows/debug.md",
  ".ai/workflows/review.md",
  ".ai/workflows/refactor.md",
  "docs/skills/README.md",
  "docs/domains/solana-wallet-routing.md",
  ...STANDARDS
]

const failures = []
const passes = []

const fail = (check, detail) => failures.push({ check, detail })
const pass = (check) => passes.push(check)
const abs = (p) => resolve(repoRoot, p)
const exists = (p) => existsSync(abs(p))
const read = (p) => readFileSync(abs(p), "utf8")

// ─── 1. Root contract ─────────────────────────────────────────────────────────

if (!exists("AGENTS.md")) fail("AGENTS.md exists", "AGENTS.md not found at repository root")
else pass("AGENTS.md exists")

// ─── 2. CLAUDE.md points to AGENTS.md ─────────────────────────────────────────

if (!exists("CLAUDE.md")) {
  fail("CLAUDE.md points to AGENTS.md", "CLAUDE.md not found")
} else {
  const claude = read("CLAUDE.md")
  if (!/AGENTS\.md/.test(claude)) {
    fail("CLAUDE.md points to AGENTS.md", "CLAUDE.md does not reference AGENTS.md")
  } else if (claude.length > 2000) {
    fail(
      "CLAUDE.md points to AGENTS.md",
      `CLAUDE.md is ${claude.length} bytes — it should be a small pointer, not a duplicate of the contract`
    )
  } else {
    pass("CLAUDE.md points to AGENTS.md")
  }
}

// ─── 3. Six standards exist with authority metadata ───────────────────────────

for (const std of STANDARDS) {
  if (!exists(std)) { fail("standards exist", `missing ${std}`); continue }
  const text = read(std)
  const missingMeta = []
  if (!/^\|\s*Version\s*\|/m.test(text)) missingMeta.push("Version")
  if (!/^\|\s*Effective\s*\|/m.test(text)) missingMeta.push("Effective")
  if (!/^\|\s*Authority\s*\|/m.test(text)) missingMeta.push("Authority")
  if (!/##\s*Supersedes/.test(text)) missingMeta.push("Supersedes section")
  if (!/##\s*Normative cross-references/.test(text)) missingMeta.push("Normative cross-references section")
  if (!/##\s*Interpretation rules/.test(text)) missingMeta.push("Interpretation rules section")
  if (!/disagreement must be logged and deliberately resolved/.test(text)) {
    missingMeta.push("code/standard disagreement rule")
  }
  if (missingMeta.length) fail(`standard metadata: ${std}`, `missing ${missingMeta.join(", ")}`)
  else pass(`standard metadata: ${std}`)
}

if (exists("docs/standards/README.md")) pass("standards README exists")
else fail("standards README exists", "docs/standards/README.md not found")

// ─── 4. Task map parses deterministically, with no duplicate keys ─────────────

const MAP = ".ai/task-map.json"
let map = null

/**
 * JSON.parse silently keeps the last of duplicated keys, so scan the raw text.
 * Tracks string state and container depth to collect key names per object.
 */
function findDuplicateKeys(source) {
  const duplicates = []
  const stack = []
  let inString = false
  let escaped = false
  let current = ""
  let lastString = null

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]

    if (inString) {
      if (escaped) { escaped = false; current += ch; continue }
      if (ch === "\\") { escaped = true; continue }
      if (ch === '"') { inString = false; lastString = current; continue }
      current += ch
      continue
    }

    if (ch === '"') { inString = true; current = ""; continue }

    if (ch === "{") { stack.push({ type: "object", keys: new Set() }); continue }
    if (ch === "[") { stack.push({ type: "array" }); continue }
    if (ch === "}" || ch === "]") { stack.pop(); continue }

    if (ch === ":") {
      const frame = stack[stack.length - 1]
      if (frame?.type === "object" && lastString !== null) {
        if (frame.keys.has(lastString)) duplicates.push(lastString)
        frame.keys.add(lastString)
      }
      lastString = null
      continue
    }

    if (ch === ",") {
      lastString = null
      continue
    }
  }
  return duplicates
}

if (!exists(MAP)) {
  fail("task-map parses", `${MAP} not found`)
} else {
  const raw = read(MAP)
  try {
    map = JSON.parse(raw)
    pass("task-map parses")
  } catch (error) {
    fail("task-map parses", error.message)
  }

  const dupes = findDuplicateKeys(raw)
  if (dupes.length) fail("task-map has no duplicate keys", `duplicated: ${[...new Set(dupes)].join(", ")}`)
  else pass("task-map has no duplicate keys")

  // Re-serialization must be stable (no NaN/Infinity, no key reordering surprises).
  if (map) {
    try {
      JSON.parse(JSON.stringify(map))
      pass("task-map serializes deterministically")
    } catch (error) {
      fail("task-map serializes deterministically", error.message)
    }
  }
}

// ─── 5. Every task-map reference resolves ─────────────────────────────────────

function collectRoutedDocuments(m) {
  const docs = new Map() // doc -> where
  const note = (doc, where) => {
    if (!doc) return
    if (!docs.has(doc)) docs.set(doc, new Set())
    docs.get(doc).add(where)
  }
  for (const d of m.globalRequired ?? []) note(d, "globalRequired")
  for (const [name, doc] of Object.entries(m.workflows ?? {})) note(doc, `workflows.${name}`)
  for (const entry of m.paths ?? []) {
    for (const d of entry.documents ?? []) note(d, `paths[${entry.glob}].documents`)
    for (const d of entry.optional ?? []) note(d, `paths[${entry.glob}].optional`)
  }
  for (const [key, domain] of Object.entries(m.domains ?? {})) {
    for (const d of domain.documents ?? []) note(d, `domains.${key}.documents`)
    for (const d of domain.optional ?? []) note(d, `domains.${key}.optional`)
  }
  return docs
}

if (map) {
  const routed = collectRoutedDocuments(map)

  const missing = [...routed].filter(([doc]) => !exists(doc))
  if (missing.length) {
    for (const [doc, where] of missing) fail("task-map references resolve", `${doc} (from ${[...where].join(", ")})`)
  } else {
    pass(`task-map references resolve (${routed.size} documents)`)
  }

  // 5b. Nothing superseded/archived is routed.
  const never = new Set(map.exclusions?.never ?? [])
  const neverGlobs = map.exclusions?.neverGlobs ?? []
  const globRe = (g) =>
    new RegExp(
      `^${g
        .split("**")
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "[^/]*"))
        .join(".*")}$`
    )
  const violations = [...routed.keys()].filter(
    (doc) =>
      never.has(doc) ||
      neverGlobs.some((g) => globRe(g).test(doc)) ||
      doc.startsWith("docs/archive/")
  )
  if (violations.length) {
    for (const doc of violations) fail("no superseded material routed", `${doc} is routed but excluded`)
  } else {
    pass("no superseded material routed")
  }

  // 5c. Path entries must reference declared domains.
  const unknownDomains = []
  for (const entry of map.paths ?? []) {
    for (const key of entry.domains ?? []) {
      if (!map.domains?.[key]) unknownDomains.push(`${entry.glob} → ${key}`)
    }
  }
  if (unknownDomains.length) fail("path domains are declared", unknownDomains.join(", "))
  else pass("path domains are declared")

  // 5d. Required coverage the contract depends on.
  const globals = new Set(map.globalRequired ?? [])
  if (!globals.has("AGENTS.md")) fail("globalRequired includes AGENTS.md", "AGENTS.md is not globally required")
  else pass("globalRequired includes AGENTS.md")
  if (!globals.has("docs/standards/01-platform-architecture.md")) {
    fail("globalRequired includes Standard 01", "Standard 01 is not globally required")
  } else {
    pass("globalRequired includes Standard 01")
  }

  // 5e. All four workflow documents mapped and present.
  for (const name of ["implement", "debug", "review", "refactor"]) {
    const doc = map.workflows?.[name]
    if (!doc) fail("workflow documents mapped", `workflows.${name} missing`)
    else if (!exists(doc)) fail("workflow documents mapped", `${doc} not found`)
  }
  if (["implement", "debug", "review", "refactor"].every((n) => map.workflows?.[n] && exists(map.workflows[n]))) {
    pass("workflow documents mapped")
  }
}

// ─── 6. Legacy skills are signposted and never routed ─────────────────────────

if (!exists("docs/skills/README.md")) {
  fail("legacy skills signposted", "docs/skills/README.md not found")
} else {
  const text = read("docs/skills/README.md").toLowerCase()
  const hasDisclaimer = /not authoritative|legacy|superseded|disconnected/.test(text)
  const pointsOnward = /agents\.md/.test(text) && /docs\/standards/.test(text)
  if (!hasDisclaimer) fail("legacy skills signposted", "README does not state the folder is legacy/not authoritative")
  else if (!pointsOnward) fail("legacy skills signposted", "README does not point to AGENTS.md and docs/standards/")
  else pass("legacy skills signposted")
}

// ─── 7. Relative Markdown links inside governance files resolve ───────────────

const linkFailures = []
let linksChecked = 0
for (const file of GOVERNANCE_LINK_FILES) {
  if (!exists(file)) continue
  const text = read(file)
  const dir = posix.dirname(file.replace(/\\/g, "/"))
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g
  let m
  while ((m = linkRe.exec(text)) !== null) {
    const raw = m[1]
    if (/^(https?:|mailto:|#)/.test(raw)) continue
    const target = raw.split("#")[0]
    if (!target) continue
    const resolved = posix.normalize(posix.join(dir, target))
    linksChecked += 1
    if (!existsSync(resolve(repoRoot, resolved))) {
      linkFailures.push(`${file} → ${raw} (resolved ${resolved})`)
      continue
    }
    // A link ending in "/" should be a directory.
    if (target.endsWith("/") && !statSync(resolve(repoRoot, resolved)).isDirectory()) {
      linkFailures.push(`${file} → ${raw} is not a directory`)
    }
  }
}
if (linkFailures.length) for (const f of linkFailures) fail("governance links resolve", f)
else pass(`governance links resolve (${linksChecked} links)`)

// ─── 8. package.json wiring ───────────────────────────────────────────────────

if (exists("package.json")) {
  let pkg
  try { pkg = JSON.parse(read("package.json")) } catch { pkg = null }
  if (!pkg) {
    fail("package.json scripts", "package.json is not valid JSON")
  } else {
    const missingScripts = ["ai:preflight", "ai:governance:check"].filter((s) => !pkg.scripts?.[s])
    if (missingScripts.length) fail("package.json scripts", `missing ${missingScripts.join(", ")}`)
    else pass("package.json scripts")
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const line = (s = "") => process.stdout.write(`${s}\n`)
const rule = "─".repeat(72)

line()
line("PineTree AI Governance Check")
line(rule)
for (const p of passes) line(`  ok    ${p}`)
if (failures.length) {
  line()
  for (const f of failures) line(`  FAIL  ${f.check}\n          ${f.detail}`)
}
line(rule)
line(`${passes.length} passed, ${failures.length} failed`)
line()

process.exit(failures.length ? 1 : 0)
