/**
 * ledger_entries payment idempotency index — source-contract tests.
 *
 * The migration has NOT been executed by PostgreSQL: there is no local database
 * in this environment. These are therefore contract tests over the migration
 * text, not runtime proofs. They exist so a reviewer can see the safety
 * properties are present before the SQL is ever run, and so a later edit cannot
 * quietly remove one.
 *
 * Assertions run against comment-stripped executable SQL, so prose explaining a
 * rule can neither satisfy nor defeat a test about it.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const MIGRATIONS = join(process.cwd(), "database", "migrations")
const VERSION = "20260806130000"
const FILENAME = `${VERSION}_ensure_ledger_entries_payment_unique_index.sql`
const MIGRATION = join(MIGRATIONS, FILENAME)

const CANONICAL_INDEX = "ledger_entries_payment_id_on_conflict_idx"
const REDUNDANT_INDEXES = [
  "ledger_entries_payment_id_unique_idx",
  "ledger_entries_payment_id_idx",
] as const

function sql(): string {
  return readFileSync(MIGRATION, "utf8")
}

/** Executable SQL only: `--` line comments and `/* *​/` block comments removed. */
function code(): string {
  return sql()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
}

/* ══ Structure ══════════════════════════════════════════════════════════════ */

describe("migration structure", () => {
  it("exists under a unique 14-digit version", () => {
    expect(existsSync(MIGRATION)).toBe(true)
    expect(VERSION).toMatch(/^\d{14}$/)

    const versions = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.split("_")[0])
    expect(versions.filter((v) => v === VERSION)).toHaveLength(1)
  })

  it("sorts after every existing migration so it is forward-only", () => {
    const others = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql") && name !== FILENAME)
      .map((name) => name.split("_")[0])
      .filter((v) => /^\d{14}$/.test(v))

    for (const other of others) {
      expect(Number(VERSION)).toBeGreaterThan(Number(other))
    }
  })

  it("runs inside a single transaction", () => {
    const body = code()
    expect(body).toMatch(/^\s*begin;/)
    expect(body.trimEnd().endsWith("commit;")).toBe(true)
  })
})

/* ══ Requirement 5 — duplicates are checked before any DDL ══════════════════ */

describe("duplicate preflight precedes all index DDL", () => {
  it("detects duplicate non-null payment_id values", () => {
    const body = code()
    expect(body).toContain("where payment_id is not null")
    expect(body).toContain("having count(*) > 1")
    // Aborts rather than reporting and continuing.
    expect(body).toMatch(/raise exception[\s\S]{0,400}duplicate rows/)
  })

  it("places the duplicate check before the CREATE INDEX and before any DROP", () => {
    const body = code()
    const duplicateCheck = body.indexOf("having count(*) > 1")
    const createIndex = body.indexOf("create unique index")
    const firstDrop = body.indexOf("drop index")

    expect(duplicateCheck).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(-1)
    expect(firstDrop).toBeGreaterThan(-1)

    expect(duplicateCheck).toBeLessThan(createIndex)
    expect(duplicateCheck).toBeLessThan(firstDrop)
  })

  it("does not delete or merge duplicate rows to force the index through", () => {
    const body = code().toLowerCase()
    expect(body).not.toContain("delete from")
    expect(body).not.toContain("truncate")
    expect(body).not.toContain("insert into")
    expect(body).not.toMatch(/\bupdate\s+public\./)
  })

  it("checks the table and column exist before doing anything", () => {
    const body = code()
    const tableCheck = body.indexOf("to_regclass('public.ledger_entries')")
    const duplicateCheck = body.indexOf("having count(*) > 1")
    expect(tableCheck).toBeGreaterThan(-1)
    expect(tableCheck).toBeLessThan(duplicateCheck)
  })
})

/* ══ Requirement 6 — the canonical unique index is created ═════════════════ */

describe("canonical unique index", () => {
  it("creates a UNIQUE index on public.ledger_entries(payment_id) idempotently", () => {
    const body = code()
    expect(body).toMatch(
      new RegExp(
        `create\\s+unique\\s+index\\s+if\\s+not\\s+exists\\s+${CANONICAL_INDEX}\\s*\\n?\\s*on\\s+public\\.ledger_entries\\s*\\(\\s*payment_id\\s*\\)`,
        "i"
      )
    )
  })

  it("is the only index this migration creates", () => {
    const creates = code().match(/create\s+(unique\s+)?index/gi) || []
    expect(creates).toHaveLength(1)
  })

  it("confirms the index is unique and single-column before dropping anything", () => {
    const body = code()
    const confirm = body.indexOf("indisunique")
    const firstDrop = body.indexOf("drop index")
    expect(confirm).toBeGreaterThan(-1)
    expect(confirm).toBeLessThan(firstDrop)
    expect(body).toContain("idx.indnatts = 1")
  })

  it("documents the three guarantees the index supports", () => {
    // These live in the COMMENT ON INDEX, which is executable SQL.
    const body = code()
    const indexComment = body.slice(body.indexOf("comment on index"))
    expect(indexComment).toMatch(/duplicate-confirmation protection/i)
    expect(indexComment).toMatch(/onConflict: "payment_id"/i)
    expect(indexComment).toMatch(/idempotent financial posting/i)
  })
})

/* ══ Requirement 7 — only the two named indexes are dropped ════════════════ */

describe("redundant index cleanup", () => {
  it("drops exactly two indexes", () => {
    const drops = code().match(/drop\s+index/gi) || []
    expect(drops).toHaveLength(2)
  })

  it("drops only the two named redundant indexes, using IF EXISTS", () => {
    const body = code()
    const dropped = [...body.matchAll(/drop\s+index\s+if\s+exists\s+([a-z0-9_.]+)\s*;/gi)].map(
      (match) => match[1].replace(/^public\./, "")
    )
    expect(dropped).toHaveLength(2)
    expect(new Set(dropped)).toEqual(new Set(REDUNDANT_INDEXES))
  })

  it("refuses to drop a constraint-backed index", () => {
    const body = code()
    const guard = body.indexOf("pg_constraint")
    const firstDrop = body.indexOf("drop index")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(firstDrop)
    expect(body).toMatch(/raise exception[\s\S]{0,300}constraint-backed/i)
  })

  it("verifies the canonical index survives and the redundant names are gone", () => {
    const body = code()
    const postCheck = body.slice(body.lastIndexOf("drop index"))
    expect(postCheck).toContain(CANONICAL_INDEX)
    for (const name of REDUNDANT_INDEXES) {
      expect(postCheck).toContain(name)
    }
  })
})

/* ══ Requirements 8 & 9 — primary key and unrelated indexes untouched ══════ */

describe("primary key and unrelated indexes are untouched", () => {
  it("never names the primary key", () => {
    expect(code()).not.toContain("ledger_entries_pkey")
  })

  it("never drops a constraint or alters the table", () => {
    const body = code().toLowerCase()
    expect(body).not.toContain("drop constraint")
    expect(body).not.toContain("alter table")
    expect(body).not.toContain("drop table")
    expect(body).not.toContain("drop column")
  })

  it("never references a merchant_id or created_at index", () => {
    const body = code().toLowerCase()
    expect(body).not.toContain("merchant_id")
    expect(body).not.toContain("created_at")
  })

  it("touches no table other than public.ledger_entries", () => {
    const body = code()
    const tableRefs = [...body.matchAll(/public\.([a-z0-9_]+)/gi)].map((match) => match[1])
    const nonLedger = tableRefs.filter(
      (name) =>
        name !== "ledger_entries" &&
        name !== CANONICAL_INDEX &&
        !REDUNDANT_INDEXES.includes(name as (typeof REDUNDANT_INDEXES)[number])
    )
    expect(nonLedger).toEqual([])
  })

  it("performs no data-modifying statement at all", () => {
    const body = code().toLowerCase()
    for (const forbidden of ["delete", "truncate", "insert", "merge"]) {
      expect(body).not.toMatch(new RegExp(`\\b${forbidden}\\b`))
    }
  })
})

/* ══ Alignment with the code and preflight that depend on the index ════════ */

describe("stays aligned with the consumers of the index", () => {
  it("satisfies the predicate the Shift4 attempts migration preflights on", () => {
    // 20260731163100 raises unless a single-column UNIQUE index exists on
    // ledger_entries(payment_id). This migration must create exactly that.
    const shift4 = readFileSync(
      join(MIGRATIONS, "20260731163100_create_shift4_payment_attempts.sql"),
      "utf8"
    )
    expect(shift4).toContain("requires a UNIQUE index on ledger_entries (payment_id)")

    const body = code()
    expect(body).toContain("idx.indisunique")
    expect(body).toContain("idx.indnatts = 1")
    expect(body).toContain("attname = 'payment_id'")
  })

  it("matches the onConflict target used by database/ledgerEntries.ts", () => {
    const helper = readFileSync(join(process.cwd(), "database", "ledgerEntries.ts"), "utf8")
    expect(helper).toContain("onConflict: 'payment_id'")
    expect(helper).toContain("ignoreDuplicates: true")
    // The index must be on precisely that column for the clause to be legal.
    expect(code()).toMatch(/on\s+public\.ledger_entries\s*\(\s*payment_id\s*\)/)
  })
})
