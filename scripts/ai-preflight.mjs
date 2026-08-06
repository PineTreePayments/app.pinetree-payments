#!/usr/bin/env node
/**
 * PineTree AI preflight.
 *
 * Resolves the governance documents an agent must read before planning or
 * editing, from .ai/task-map.json.
 *
 * Read-only and offline by contract: it reads the task map and checks that
 * mapped files exist. It never reads .env files or process secrets, never
 * performs network I/O, and never writes to the repository.
 *
 *   node scripts/ai-preflight.mjs --task "Add a provider adapter" --path providers/x/y.ts
 *   node scripts/ai-preflight.mjs --task "..." --json
 *
 * Exit codes:
 *   0  resolved (possibly ambiguous — ambiguity is reported, not fatal)
 *   1  a mapped governance file is missing, or the map is unusable
 *   2  bad invocation
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const MAP_PATH = ".ai/task-map.json"

// ─── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { task: "", paths: [], json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--json") { out.json = true; continue }
    if (arg === "--task") { out.task = String(argv[++i] ?? ""); continue }
    if (arg.startsWith("--task=")) { out.task = arg.slice("--task=".length); continue }
    if (arg === "--path") { const v = argv[++i]; if (v) out.paths.push(String(v)); continue }
    if (arg.startsWith("--path=")) { const v = arg.slice("--path=".length); if (v) out.paths.push(v); continue }
    if (arg === "--help" || arg === "-h") { out.help = true; continue }
    out.unknown = out.unknown || []
    out.unknown.push(arg)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

function usage() {
  process.stdout.write(
    [
      "PineTree AI preflight — resolves required governance documents.",
      "",
      "Usage:",
      '  npm run ai:preflight -- --task "<task description>" [--path <p> ...] [--json]',
      "",
      "Flags:",
      "  --task <text>   Required. Matched against domain keywords.",
      "  --path <p>      Repeatable. Files or directories you expect to touch.",
      "  --json          Machine-readable output.",
      ""
    ].join("\n")
  )
}

if (args.help) { usage(); process.exit(0) }

if (!args.task.trim()) {
  process.stderr.write("ai-preflight: --task is required.\n\n")
  usage()
  process.exit(2)
}

if (args.unknown?.length) {
  process.stderr.write(`ai-preflight: unrecognized argument(s): ${args.unknown.join(", ")}\n\n`)
  usage()
  process.exit(2)
}

// ─── Task map ─────────────────────────────────────────────────────────────────

const mapAbs = resolve(repoRoot, MAP_PATH)
if (!existsSync(mapAbs)) {
  process.stderr.write(`ai-preflight: missing ${MAP_PATH}. Governance routing is not installed.\n`)
  process.exit(1)
}

let map
try {
  map = JSON.parse(readFileSync(mapAbs, "utf8"))
} catch (error) {
  process.stderr.write(`ai-preflight: ${MAP_PATH} is not valid JSON — ${error.message}\n`)
  process.exit(1)
}

// ─── Matching helpers ─────────────────────────────────────────────────────────

/** Normalize a user-supplied path to repo-relative POSIX form. */
function normalizePath(input) {
  const raw = String(input).trim().replace(/\\/g, "/").replace(/^\.\//, "")
  // Accept absolute paths inside the repo by making them relative.
  if (/^([a-zA-Z]:)?\//.test(raw)) {
    const rel = relative(repoRoot, resolve(raw)).split(sep).join("/")
    if (rel && !rel.startsWith("..")) return rel.replace(/\/+$/, "")
  }
  return raw.replace(/\/+$/, "")
}

/**
 * Glob support is deliberately limited to the two forms the map uses:
 * `**` (any depth, including none) and `*` (one segment, no separator).
 * Every other character is matched literally — parentheses in `app/(pos)/**`
 * must not be treated as a regex group.
 */
function globToRegExp(glob) {
  let out = ""
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i += 1
        if (glob[i + 1] === "/") { i += 1; out += "(?:.*/)?" } else { out += ".*" }
      } else {
        out += "[^/]*"
      }
      continue
    }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${out}$`)
}

/** A glob matches a supplied path if it matches the path, or the path is a containing directory. */
function pathMatchesGlob(candidate, glob) {
  const re = globToRegExp(glob)
  if (re.test(candidate)) return true
  // `--path engine/` should match `engine/**`.
  const asDir = candidate.endsWith("/") ? candidate : `${candidate}/`
  if (re.test(`${asDir}x`)) return true
  // `--path lib/wallets/solana.ts` should match `lib/wallets/**`.
  const globPrefix = glob.replace(/\*\*.*$/, "")
  if (globPrefix && globPrefix !== glob && candidate.startsWith(globPrefix)) return true
  return false
}

function keywordMatches(haystack, keyword) {
  const escaped = String(keyword).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Word-boundary match so "base" does not fire inside "database".
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack)
}

// ─── Resolution ───────────────────────────────────────────────────────────────

const task = args.task.trim()
const taskLower = task.toLowerCase()
const inputPaths = args.paths.map(normalizePath).filter(Boolean)

const required = new Map() // document -> Set of reasons
const optional = new Map()
const matchedDomains = []
const matchedPaths = []
const notes = []

function add(target, doc, reason) {
  if (!doc) return
  if (!target.has(doc)) target.set(doc, new Set())
  target.get(doc).add(reason)
}

for (const doc of map.globalRequired ?? []) add(required, doc, "global")

for (const entry of map.paths ?? []) {
  const hit = inputPaths.filter((p) => pathMatchesGlob(p, entry.glob))
  if (!hit.length) continue
  matchedPaths.push({ glob: entry.glob, matched: hit, note: entry.note ?? null })
  if (entry.note) notes.push(`${entry.glob} — ${entry.note}`)
  for (const doc of entry.documents ?? []) add(required, doc, `path ${entry.glob}`)
  for (const doc of entry.optional ?? []) add(optional, doc, `path ${entry.glob}`)
  for (const key of entry.domains ?? []) {
    if (!matchedDomains.some((d) => d.key === key)) {
      matchedDomains.push({ key, via: `path ${entry.glob}` })
    }
  }
}

for (const [key, domain] of Object.entries(map.domains ?? {})) {
  const hits = (domain.keywords ?? []).filter((k) => keywordMatches(taskLower, k))
  if (!hits.length) continue
  const existing = matchedDomains.find((d) => d.key === key)
  if (existing) existing.via = `${existing.via}, keyword "${hits[0]}"`
  else matchedDomains.push({ key, via: `keyword "${hits[0]}"` })
}

// Pull documents for every matched domain, however it was matched.
for (const { key } of matchedDomains) {
  const domain = map.domains?.[key]
  if (!domain) {
    notes.push(`task-map: path entry references unknown domain "${key}"`)
    continue
  }
  for (const doc of domain.documents ?? []) add(required, doc, `domain ${key}`)
  for (const doc of domain.optional ?? []) add(optional, doc, `domain ${key}`)
  if (domain.note) notes.push(`${key} — ${domain.note}`)
}

// Anything required is never merely optional.
for (const doc of required.keys()) optional.delete(doc)

// Workflow inference.
let workflow = map.defaultWorkflow ?? "implement"
let workflowVia = "default"
for (const [name, keywords] of Object.entries(map.workflowKeywords ?? {})) {
  const hit = (keywords ?? []).find((k) => keywordMatches(taskLower, k))
  if (hit) { workflow = name; workflowVia = `keyword "${hit}"`; break }
}
const workflowDoc = map.workflows?.[workflow] ?? null

const ambiguous = matchedDomains.length === 0
const excludedHits = []
const never = new Set(map.exclusions?.never ?? [])
const neverGlobs = map.exclusions?.neverGlobs ?? []
for (const doc of [...required.keys(), ...optional.keys()]) {
  if (never.has(doc) || neverGlobs.some((g) => globToRegExp(g).test(doc))) excludedHits.push(doc)
}

// Every routed document must exist.
const allDocs = [...required.keys(), ...optional.keys()]
if (workflowDoc) allDocs.push(workflowDoc)
const missing = allDocs.filter((doc) => !existsSync(resolve(repoRoot, doc)))

// ─── Output ───────────────────────────────────────────────────────────────────

if (args.json) {
  process.stdout.write(
    `${JSON.stringify(
      {
        task,
        paths: inputPaths,
        domains: matchedDomains.map((d) => d.key),
        domainDetail: matchedDomains,
        matchedPaths,
        required: [...required.keys()],
        optional: [...optional.keys()],
        workflow,
        workflowDocument: workflowDoc,
        ambiguous,
        notes,
        missing,
        excludedHits,
        ok: missing.length === 0 && excludedHits.length === 0
      },
      null,
      2
    )}\n`
  )
} else {
  const line = (s = "") => process.stdout.write(`${s}\n`)
  const rule = "─".repeat(72)

  line()
  line("PineTree AI Preflight")
  line(rule)
  line(`Task: ${task}`)
  line()

  line("1. Detected domains")
  if (matchedDomains.length) {
    for (const d of matchedDomains) {
      const label = map.domains?.[d.key]?.label ?? d.key
      line(`   • ${label}  [${d.key}]  ← ${d.via}`)
    }
  } else {
    line("   (none)")
  }
  line()

  line("2. Affected paths")
  if (matchedPaths.length) {
    for (const p of matchedPaths) line(`   • ${p.glob}  ← ${p.matched.join(", ")}`)
  } else if (inputPaths.length) {
    line(`   • no map entry matched: ${inputPaths.join(", ")}`)
  } else {
    line("   (none supplied)")
  }
  line()

  line("3. Required documents — read all of these before planning or editing")
  for (const [doc, reasons] of required) line(`   [ ] ${doc}  (${[...reasons].join("; ")})`)
  if (optional.size) {
    line()
    line("   Recommended for this task:")
    for (const [doc, reasons] of optional) line(`   ( ) ${doc}  (${[...reasons].join("; ")})`)
  }
  line()

  line("4. Workflow")
  line(`   ${workflowDoc ?? "(none mapped)"}  [${workflow}, ${workflowVia}]`)
  line()

  line("5. Unresolved or ambiguous")
  if (ambiguous) {
    line("   AMBIGUOUS — no domain keyword matched and no path resolved a domain.")
    line("   Do not guess. Narrow the task or pass --path, then run again.")
    line("   Available domains:")
    const keys = Object.keys(map.domains ?? {})
    for (let i = 0; i < keys.length; i += 4) {
      line(`     ${keys.slice(i, i + 4).join(", ")}`)
    }
  } else {
    line("   none")
  }

  if (notes.length) {
    line()
    line("Notes")
    for (const n of notes) line(`   ! ${n}`)
  }

  if (excludedHits.length) {
    line()
    line("EXCLUSION VIOLATION — these are routed but marked never-route:")
    for (const doc of excludedHits) line(`   ✗ ${doc}`)
  }

  if (missing.length) {
    line()
    line("MISSING GOVERNANCE FILES — routing is broken:")
    for (const doc of missing) line(`   ✗ ${doc}`)
  }

  line()
  line(rule)
  if (missing.length || excludedHits.length) {
    line("FAIL — fix the routing above before proceeding.")
  } else if (ambiguous) {
    line("Preflight INCOMPLETE — global documents resolved, but no domain was identified.")
    line("Narrow the task or pass --path before planning.")
  } else {
    line("Preflight OK. Read the required documents, then plan.")
  }
  line()
}

if (missing.length) process.exit(1)
if (excludedHits.length) process.exit(1)
process.exit(0)
