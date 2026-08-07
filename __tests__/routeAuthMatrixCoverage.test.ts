/**
 * Route-auth matrix completeness.
 *
 * The matrix is documentation, not enforcement — so the one thing tests CAN
 * guarantee is that it stays complete and internally consistent. The route
 * inventory below is derived from the filesystem on every run; nothing here
 * trusts a hand-maintained count. Adding a route file, or adding an exported
 * HTTP method to an existing route, fails this suite until
 * docs/security/route-auth-matrix.md gains the corresponding row.
 *
 * These tests deliberately do NOT assert that any route is secure. They assert
 * that every route is *described*, and that the description uses the vocabulary
 * the document defines.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const MATRIX_PATH = "docs/security/route-auth-matrix.md"
const API_DIR = path.join(ROOT, "app", "api")
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const

const CLASSES = new Set([
  "PUBLIC",
  "PUBLIC_CAPABILITY",
  "API_KEY",
  "DASHBOARD_SESSION",
  "ADMIN",
  "TERMINAL_SESSION",
  "PROVIDER_WEBHOOK",
  "OAUTH_CALLBACK",
  "CRON_INTERNAL",
  "DEBUG_NONPRODUCTION",
  "RETIRED",
])

const RESULTS = new Set([
  "VERIFIED",
  "VERIFIED_PUBLIC",
  "VERIFIED_RETIRED",
  "FINDING",
  "RUNTIME_EVIDENCE_REQUIRED",
  "NOT_APPLICABLE",
])

/* ── Derived inventory ───────────────────────────────────────────────────── */

function walkRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkRouteFiles(full, out)
    else if (entry.name === "route.ts") out.push(path.relative(ROOT, full).replace(/\\/g, "/"))
  }
  return out
}

/** app/api/foo/[bar]/route.ts -> /api/foo/[bar]; route groups "(x)" are stripped. */
function urlPathFor(file: string): string {
  const segments = file
    .replace(/^app/, "")
    .replace(/\/route\.ts$/, "")
    .split("/")
    .filter(Boolean)
    .filter((s) => !/^\(.*\)$/.test(s))
  return "/" + segments.join("/")
}

/**
 * Exported HTTP methods for one route file.
 *
 * Covers `export function GET`, `export const GET =`, and the re-export forms
 * `export { POST } from "../route"` / `export { handler as POST }` — the last of
 * which is a real handler (see /api/payments/create) and must not be missed.
 */
function exportedMethods(source: string): string[] {
  const found = new Set<string>()
  for (const method of HTTP_METHODS) {
    const patterns = [
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*[(<]`),
      new RegExp(`export\\s+const\\s+${method}\\s*[:=]`),
      new RegExp(`export\\s*\\{[^}]*\\bas\\s+${method}\\b`, "s"),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`, "s"),
    ]
    if (patterns.some((re) => re.test(source))) found.add(method)
  }
  return [...found]
}

const routeFiles = walkRouteFiles(API_DIR).sort()

type Handler = { file: string; url: string; method: string }
const inventory: Handler[] = []
for (const file of routeFiles) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8")
  for (const method of exportedMethods(source)) {
    inventory.push({ file, url: urlPathFor(file), method })
  }
}

/* ── Matrix parsing (section 5 only) ─────────────────────────────────────── */

const matrix = fs.readFileSync(path.join(ROOT, MATRIX_PATH), "utf8")

type Row = {
  url: string
  method: string
  cls: string
  auth: string
  authz: string
  state: string
  evidence: string
  result: string
  findings: string[]
  raw: string
}

function parseMatrixRows(): Row[] {
  // Bound the scan to the complete-matrix section so that illustrative tables
  // elsewhere in the document can never be mistaken for inventory rows.
  const start = matrix.indexOf("## 5. Complete route matrix")
  const end = matrix.indexOf("## 6. Findings")
  expect(start, "matrix must contain section 5").toBeGreaterThan(-1)
  expect(end, "matrix must contain section 6").toBeGreaterThan(start)
  const section = matrix.slice(start, end)

  const rows: Row[] = []
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue
    const cells = line.split("|").slice(1, -1).map((c) => c.trim())
    if (cells.length !== 8) continue
    if (!/^`\/api\//.test(cells[0])) continue
    const resultCell = cells[7]
    rows.push({
      url: cells[0].replace(/`/g, ""),
      method: cells[1],
      cls: cells[2],
      auth: cells[3],
      authz: cells[4],
      state: cells[5],
      evidence: cells[6],
      result: resultCell.split(/\s+/)[0],
      findings: [...resultCell.matchAll(/RA-\d+/g)].map((m) => m[0]),
      raw: line,
    })
  }
  return rows
}

const rows = parseMatrixRows()
const rowKey = (r: { url: string; method: string }) => `${r.method} ${r.url}`

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("route-auth matrix completeness", () => {
  it("derives a non-trivial inventory (guards against a broken parser)", () => {
    expect(routeFiles.length).toBeGreaterThan(200)
    expect(inventory.length).toBeGreaterThanOrEqual(routeFiles.length)
    // Every route file must expose at least one handler, or the extractor is wrong.
    const silent = routeFiles.filter((f) => !inventory.some((h) => h.file === f))
    expect(silent, "route files with no detected HTTP export").toEqual([])
  })

  it("lists every route file in the matrix", () => {
    const documented = new Set(rows.map((r) => r.url))
    const missing = [...new Set(inventory.map((h) => h.url))].filter((u) => !documented.has(u)).sort()
    expect(missing, "route paths absent from the matrix").toEqual([])
  })

  it("lists every exported HTTP method for every route", () => {
    const documented = new Set(rows.map(rowKey))
    const missing = inventory.filter((h) => !documented.has(rowKey(h))).map(rowKey).sort()
    expect(missing, "route+method pairs absent from the matrix").toEqual([])
  })

  it("has no matrix row for a route+method that does not exist in code", () => {
    const real = new Set(inventory.map(rowKey))
    const phantom = rows.filter((r) => !real.has(rowKey(r))).map(rowKey).sort()
    expect(phantom, "matrix rows with no corresponding handler").toEqual([])
  })

  it("has no duplicate route+method row", () => {
    const seen = new Map<string, number>()
    for (const r of rows) seen.set(rowKey(r), (seen.get(rowKey(r)) ?? 0) + 1)
    expect([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([])
  })

  it("matches the derived handler count exactly", () => {
    expect(rows.length).toBe(inventory.length)
  })

  it("keeps the counts stated in section 1 equal to the derived inventory", () => {
    // The document may state totals, but they must be checked against reality
    // rather than trusted — that is what made the previous matrix go stale.
    const scope = matrix.slice(0, matrix.indexOf("## 2."))
    const files = scope.match(/\*\*Route files:\*\*\s*(\d+)/)
    const handlers = scope.match(/\*\*Exported method handlers:\*\*\s*(\d+)/)
    expect(files, "section 1 must state a route-file count").not.toBeNull()
    expect(handlers, "section 1 must state a handler count").not.toBeNull()
    expect(Number(files![1])).toBe(routeFiles.length)
    expect(Number(handlers![1])).toBe(inventory.length)
  })

  it("never represents a route by a wildcard or a method list", () => {
    const bad = rows.filter((r) => !HTTP_METHODS.includes(r.method as (typeof HTTP_METHODS)[number]))
    expect(bad.map((r) => `${r.method} ${r.url}`), "Method cell must be exactly one HTTP verb").toEqual([])
    expect(rows.filter((r) => /[*,]|\bALL\b/.test(r.method)).map(rowKey)).toEqual([])
  })
})

describe("route-auth matrix vocabulary", () => {
  it("uses only classifications defined in section 2", () => {
    const unknown = [...new Set(rows.map((r) => r.cls))].filter((c) => !CLASSES.has(c))
    expect(unknown).toEqual([])
  })

  it("declares every classification it uses", () => {
    const defs = matrix.slice(matrix.indexOf("## 2."), matrix.indexOf("## 3."))
    for (const cls of new Set(rows.map((r) => r.cls))) {
      expect(defs, `section 2 must define ${cls}`).toContain(`\`${cls}\``)
    }
  })

  it("uses only recognised result values", () => {
    const unknown = [...new Set(rows.map((r) => r.result))].filter((r) => !RESULTS.has(r))
    expect(unknown).toEqual([])
  })

  it("uses no vague verdicts anywhere in the matrix section", () => {
    const section = matrix.slice(matrix.indexOf("## 5."), matrix.indexOf("## 6."))
    for (const vague of [/probably protected/i, /presumably/i, /should be (?:safe|protected)/i, /assumed safe/i, /looks? (?:safe|fine)/i]) {
      expect(section, `matrix must not hedge (${vague})`).not.toMatch(vague)
    }
  })

  it("records a state-change verdict for every row", () => {
    expect(rows.filter((r) => !/^(Yes|No)$/.test(r.state)).map(rowKey)).toEqual([])
  })

  it("resolves every finding id referenced by a row", () => {
    const findingsSection = matrix.slice(matrix.indexOf("## 6. Findings"))
    const referenced = [...new Set(rows.flatMap((r) => r.findings))]
    expect(referenced.length, "the matrix should reference at least one finding").toBeGreaterThan(0)
    for (const id of referenced) {
      expect(findingsSection, `finding ${id} must have a section 6 entry`).toMatch(
        new RegExp(`^\\| ${id} \\|`, "m")
      )
      expect(findingsSection, `finding ${id} must have a detail heading`).toMatch(
        new RegExp(`^### ${id} —`, "m")
      )
    }
  })

  it("gives every section 6 finding a severity and at least one row or an explicit scope", () => {
    const table = matrix.slice(matrix.indexOf("## 6. Findings"), matrix.indexOf("### RA-1"))
    const ids = [...table.matchAll(/^\| (RA-\d+) \| \*{0,2}(CRITICAL|HIGH|MEDIUM|LOW)\*{0,2} \|/gm)]
    expect(ids.length, "every findings-table row needs a recognised severity").toBeGreaterThan(0)
    const declared = ids.map((m) => m[1])
    expect(new Set(declared).size, "finding ids must be unique").toBe(declared.length)
  })
})

describe("route-auth matrix class invariants", () => {
  it("classifies every webhook intake handler as PROVIDER_WEBHOOK or RETIRED", () => {
    // A non-GET handler under /api/webhooks is intake and must be classified as
    // a verified provider webhook (or retired). GET handlers on these routes are
    // liveness probes; they may be PUBLIC, but only if the row says so — that
    // keeps an unverified intake route from hiding behind the probe exemption.
    const offenders = rows
      .filter((r) => r.url.startsWith("/api/webhooks/"))
      .filter((r) => {
        if (r.cls === "PROVIDER_WEBHOOK" || r.cls === "RETIRED") return false
        return !(r.method === "GET" && r.cls === "PUBLIC" && /liveness|health/i.test(r.auth))
      })
      .map((r) => `${rowKey(r)} => ${r.cls}`)
    expect(offenders).toEqual([])
  })

  it("keeps every webhook POST classified as verified provider intake", () => {
    const posts = rows.filter((r) => r.url.startsWith("/api/webhooks/") && r.method === "POST")
    expect(posts.length).toBeGreaterThan(5)
    for (const r of posts) {
      expect(["PROVIDER_WEBHOOK", "RETIRED"], rowKey(r)).toContain(r.cls)
    }
  })

  it("keeps the retired generic provider webhook route RETIRED for every method", () => {
    const retired = rows.filter((r) => r.url === "/api/webhooks/provider")
    expect(retired.length).toBeGreaterThan(0)
    for (const r of retired) {
      expect(r.cls, `${rowKey(r)} must stay RETIRED`).toBe("RETIRED")
      expect(r.result).toBe("VERIFIED_RETIRED")
    }
    // The 410 handler must still exist — a retired row may not point at nothing.
    const file = path.join(ROOT, "app/api/webhooks/provider/route.ts")
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file, "utf8")).toContain("410")
  })

  it("lists the retired Shopify session route exactly once, as retired", () => {
    // Audit finding RA-2 was resolved by retiring this route rather than by
    // signing it: a Shopify app-proxy signature covers the query string only, so
    // the order payload would have stayed caller-controlled. The row must not
    // drift back to an active classification.
    const retired = rows.filter((r) => r.url === "/api/shopify/session")
    expect(retired.map(rowKey)).toEqual(["POST /api/shopify/session"])
    expect(retired[0].cls).toBe("RETIRED")
    expect(retired[0].result).toBe("VERIFIED_RETIRED")

    // The 410 handler must still exist — a retired row may not point at nothing.
    const file = path.join(ROOT, "app/api/shopify/session/route.ts")
    expect(fs.existsSync(file)).toBe(true)
    const source = fs.readFileSync(file, "utf8")
    expect(source).toContain("410")
    // And it must do no work: no lookup, no validation, no session creation.
    for (const forbidden of [
      "getActiveShopifyConnection",
      "validateShopifyOrderContext",
      "createCheckoutSessionEngine",
      "verifyShopifyAppProxySignature",
      "req.json",
    ]) {
      expect(source, `retired route must not call ${forbidden}`).not.toContain(forbidden)
    }
  })

  it("does not classify an /api/admin route as a plain merchant session without justification", () => {
    // /api/admin/me is legitimately a merchant-scoped "who am I" surface. Any
    // such row must say so in its authorization cell rather than pass silently.
    const offenders = rows
      .filter((r) => r.url.startsWith("/api/admin/") && r.cls === "DASHBOARD_SESSION")
      .filter((r) => !/\bown\b/i.test(r.authz))
      .map(rowKey)
    expect(offenders, "admin-path rows classified DASHBOARD_SESSION need documented justification").toEqual([])
  })

  it("never marks a debug route VERIFIED_PUBLIC", () => {
    const offenders = rows
      .filter((r) => r.url.startsWith("/api/debug/"))
      .filter((r) => r.result === "VERIFIED_PUBLIC" || r.cls === "PUBLIC")
      .map(rowKey)
    expect(offenders).toEqual([])
  })

  it("requires an explicit authentication statement wherever authentication is absent", () => {
    // A PUBLIC row must say so; it may not leave the column blank or vague.
    const offenders = rows
      .filter((r) => r.cls === "PUBLIC" || r.cls === "PUBLIC_CAPABILITY")
      .filter((r) => r.auth.length < 4 || r.authz.length < 4)
      .map(rowKey)
    expect(offenders).toEqual([])
  })

  it("marks every cron and internal-secret row as authenticating a caller class, not a merchant", () => {
    const cron = rows.filter((r) => r.url.startsWith("/api/cron/"))
    expect(cron.length).toBeGreaterThan(0)
    for (const r of cron) expect(r.cls, rowKey(r)).toBe("CRON_INTERNAL")
  })
})

describe("route-auth matrix references", () => {
  it("points every evidence link at a real file and a plausible line", () => {
    const broken: string[] = []
    for (const r of rows) {
      const m = r.evidence.match(/\(\.\.\/\.\.\/([^)#]+)#L(\d+)\)/)
      if (!m) { broken.push(`${rowKey(r)} (unparseable evidence cell)`); continue }
      const [, file, lineNo] = m
      const abs = path.join(ROOT, file)
      if (!fs.existsSync(abs)) { broken.push(`${rowKey(r)} -> missing ${file}`); continue }
      const lines = fs.readFileSync(abs, "utf8").split("\n").length
      if (Number(lineNo) > lines) broken.push(`${rowKey(r)} -> ${file}#L${lineNo} beyond EOF (${lines})`)
    }
    expect(broken).toEqual([])
  })

  it("cites the route's own file as its evidence", () => {
    const mismatched = rows
      .filter((r) => {
        const m = r.evidence.match(/\(\.\.\/\.\.\/([^)#]+)#L\d+\)/)
        return m ? urlPathFor(m[1]) !== r.url : false
      })
      .map(rowKey)
    expect(mismatched).toEqual([])
  })

  it("resolves every relative document link in the matrix", () => {
    const broken: string[] = []
    // Two link forms: angle-bracketed (used when the path contains parentheses,
    // e.g. the app/(pos) route group) and bare. Parsing the bare form with a
    // naive [^)]+ would truncate the former at its first inner paren.
    const links = [
      ...[...matrix.matchAll(/\]\(<([^>]+)>\)/g)].map((m) => m[1]),
      ...[...matrix.matchAll(/\]\((?!<)([^)\s]+)\)/g)].map((m) => m[1]),
    ]
    for (const link of links) {
      if (!link.startsWith(".")) continue
      const target = link.split("#")[0]
      if (!target) continue
      const abs = path.resolve(path.join(ROOT, "docs", "security"), target)
      if (!fs.existsSync(abs)) broken.push(link)
    }
    expect(links.length, "the matrix should carry relative links").toBeGreaterThan(50)
    expect([...new Set(broken)]).toEqual([])
  })

  it("is reachable from the documentation index", () => {
    expect(fs.readFileSync(path.join(ROOT, "docs/INDEX.md"), "utf8")).toContain("security/route-auth-matrix.md")
  })

  it("no longer carries the withdrawn partial-coverage warning", () => {
    expect(matrix).not.toContain("not** a complete route inventory")
    expect(matrix).not.toMatch(/unaudited, not unprotected/)
    expect(matrix).toMatch(/2026-08-06/)
  })
})
