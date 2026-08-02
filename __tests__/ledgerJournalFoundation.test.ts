/**
 * PineTree balanced-journal foundation - source-contract tests.
 *
 * Neither migration has been executed by PostgreSQL: there is no local database,
 * Docker, or Supabase CLI in this environment. These are therefore CONTRACT
 * tests over the migration text, not runtime proofs. They exist so a reviewer
 * can see the invariants are present before the SQL is ever run, and so a later
 * edit cannot quietly remove one.
 *
 * They are deliberately asserted against comment-stripped executable SQL, so
 * prose explaining a rule can neither satisfy nor defeat a test about it.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const MIGRATIONS = join(process.cwd(), "database", "migrations")
const JOURNAL_VERSION = "20260731163000"
const SHIFT4_VERSION = "20260731163100"
const LEDGER_ALIAS_FIX_VERSION = "20260802030000"

const JOURNAL = join(MIGRATIONS, `${JOURNAL_VERSION}_create_ledger_journal_foundation.sql`)
const SHIFT4 = join(MIGRATIONS, `${SHIFT4_VERSION}_create_shift4_payment_attempts.sql`)
const LEDGER_ALIAS_FIX = join(MIGRATIONS, `${LEDGER_ALIAS_FIX_VERSION}_fix_ledger_posting_link_alias.sql`)

function sql(path: string): string {
  return readFileSync(path, "utf8")
}

/** Executable SQL only: `--` and block comments removed. */
function code(path: string): string {
  return sql(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
}

/* ══ Migration structure ════════════════════════════════════════════════════ */

describe("migration structure", () => {
  it("has both migrations under unique 14-digit versions", () => {
    expect(existsSync(JOURNAL)).toBe(true)
    expect(existsSync(SHIFT4)).toBe(true)

    // Unique, ordered versions - NOT two files sharing a date prefix whose
    // order depends on the rest of the filename sorting favourably.
    for (const version of [JOURNAL_VERSION, SHIFT4_VERSION]) {
      expect(version, version).toMatch(/^\d{14}$/)
    }
    expect(JOURNAL_VERSION).not.toBe(SHIFT4_VERSION)
    expect(Number(JOURNAL_VERSION)).toBeLessThan(Number(SHIFT4_VERSION))
  })

  it("gives every migration in the directory a unique version prefix", () => {
    const versions = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.split("_")[0])
    const duplicates = versions.filter(
      (v, i) => versions.indexOf(v) !== i && /^\d{14}$/.test(v)
    )
    expect(duplicates).toEqual([])
  })

  it("asserts the journal exists before creating Shift4 objects", () => {
    const shift4 = code(SHIFT4)
    expect(shift4).toContain("public.ledger_accounts")
    expect(shift4).toContain("public.ledger_transactions")
    expect(shift4).toContain("post_ledger_transaction")
    expect(shift4).toContain(`apply ${JOURNAL_VERSION}_create_ledger_journal_foundation.sql first`)
  })

  it("wraps each migration in exactly one transaction", () => {
    for (const path of [JOURNAL, SHIFT4]) {
      const raw = sql(path)
      // Strip dollar-quoted bodies so a BEGIN inside PL/pgSQL is not counted.
      const tags = [...raw.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/g)].map((m) => m[0])
      let stripped = raw
      for (const tag of new Set(tags)) {
        const esc = tag.replace(/\$/g, "\\$")
        stripped = stripped.replace(new RegExp(`${esc}[\\s\\S]*?${esc}`, "g"), "<<BODY>>")
      }
      expect((stripped.match(/^begin;/gm) || []).length, path).toBe(1)
      expect((stripped.match(/^commit;/gm) || []).length, path).toBe(1)
    }
  })

  it("keeps every dollar-quoted body balanced", () => {
    for (const path of [JOURNAL, SHIFT4]) {
      const tags = [...sql(path).matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/g)].map((m) => m[0])
      const counts: Record<string, number> = {}
      for (const tag of tags) counts[tag] = (counts[tag] || 0) + 1
      for (const [tag, count] of Object.entries(counts)) {
        expect(count % 2, `${path} ${tag}`).toBe(0)
      }
    }
  })

  it("contains no duplicated migration sections", () => {
    // A whole-file scripted replace once injected the entire remainder of the
    // Shift4 migration into itself. Object counts catch that immediately.
    expect((code(JOURNAL).match(/^create table public\./gm) || []).length).toBe(4)
    expect((code(SHIFT4).match(/^create table public\./gm) || []).length).toBe(2)

    for (const path of [JOURNAL, SHIFT4]) {
      const names = (code(path).match(/^create (?:unique )?index (\w+)/gm) || [])
      expect(new Set(names).size, path).toBe(names.length)
    }
  })

  it("uses strict creation statements in both migrations", () => {
    for (const path of [JOURNAL, SHIFT4]) {
      const c = code(path)
      expect(c, path).not.toMatch(/create\s+table\s+if\s+not\s+exists/i)
      expect(c, path).not.toMatch(/create\s+(unique\s+)?index\s+if\s+not\s+exists/i)
      expect(c, path).not.toMatch(/create\s+or\s+replace\s+function/i)
    }
  })

  it("never combines an aggregate with a row-locking clause", () => {
    // PostgreSQL forbids it outright:
    // https://www.postgresql.org/docs/current/sql-select.html
    for (const path of [JOURNAL, SHIFT4]) {
      const c = code(path)
      const re = /\bfor\s+(update|share|no key update|key share)\b/gi
      let match: RegExpExecArray | null
      while ((match = re.exec(c))) {
        const statement = c.slice(c.lastIndexOf(";", match.index) + 1, match.index)
        expect(statement, `${path} @${match.index}`).not.toMatch(/\b(sum|count|max|min|avg)\s*\(/i)
      }
    }
  })

  it("never derives money by multiplying gross_amount", () => {
    for (const path of [JOURNAL, SHIFT4]) {
      expect(code(path), path).not.toMatch(/gross_amount\s*\*\s*100/)
    }
  })
})

/* ══ Journal schema ═════════════════════════════════════════════════════════ */

describe("journal schema", () => {
  it("creates the four canonical tables and leaves the legacy one alone", () => {
    const c = code(JOURNAL)
    for (const table of [
      "public.ledger_accounts",
      "public.ledger_transactions",
      "public.ledger_journal_entries",
      "public.ledger_links",
    ]) {
      expect(c, table).toContain(`create table ${table}`)
    }
    // The legacy read model is never altered, renamed, or dropped.
    expect(c).not.toMatch(/(alter|drop)\s+table\s+public\.ledger_entries/i)
  })

  it("is generic rather than Shift4-specific", () => {
    const c = code(JOURNAL)
    expect(c).not.toMatch(/shift4/i)
  })

  it("keys account identity by owner, type, currency, and network", () => {
    expect(code(JOURNAL)).toContain(
      "(owner_type, owner_id, account_type, currency_or_asset, network)"
    )
    // Network is normalized to '' so the key is total - two rows differing only
    // by a null network would otherwise both be permitted.
    expect(code(JOURNAL)).toContain("network text not null default ''")
  })

  it("supports every account type the posting model needs", () => {
    const c = code(JOURNAL)
    for (const type of [
      "provider_clearing", "merchant_receivable", "merchant_payable",
      "platform_fee_receivable", "provider_fee_expense",
      "refund_obligation", "adjustment_suspense",
    ]) {
      expect(c, type).toContain(`'${type}'`)
    }
  })

  it("makes posting keys unique and entries strictly positive", () => {
    const c = code(JOURNAL)
    expect(c).toContain("create unique index ledger_transactions_posting_key_uidx")
    expect(c).toContain("check (amount_minor > 0)")
    expect(c).toContain("check (side in ('debit', 'credit'))")
    expect(c).toContain("(ledger_transaction_id, line_number)")
  })

  it("links every posting to a lifecycle record", () => {
    const c = code(JOURNAL)
    expect(c).toContain("create table public.ledger_links")
    expect(c).toContain("payment_attempt_id text")
    expect(c).toContain("ledger_links_identity_uidx")
  })

  it("supports corrections through reversal rather than edits", () => {
    expect(code(JOURNAL)).toContain("reversal_of_transaction_id")
    expect(code(JOURNAL)).toContain("ledger_transactions_not_self_reversing_check")
  })
})

/* ══ Balance and immutability ═══════════════════════════════════════════════ */

describe("balance and immutability", () => {
  it("enforces balance at COMMIT, per currency", () => {
    const c = code(JOURNAL)
    expect(c).toContain("deferrable initially deferred")
    expect(c).toContain("create constraint trigger ledger_journal_entries_balanced")
    // Grouped per currency, so a USD debit cannot balance a EUR credit.
    expect(c).toContain("group by e.currency_or_asset")
    expect(c).toContain("filter (where e.side = 'debit')")
    expect(c).toContain("filter (where e.side = 'credit')")
  })

  it("requires at least two lines", () => {
    expect(code(JOURNAL)).toContain("must have at least two entries to balance")
  })

  it("makes transactions, entries, and links append-only", () => {
    const c = code(JOURNAL)
    for (const table of [
      "ledger_transactions", "ledger_journal_entries", "ledger_links",
    ]) {
      expect(c, table).toContain(`create trigger ${table}_immutable`)
    }
    expect(c).toContain("before update or delete")
    expect(c).toContain("Ledger history is append-only")
  })

  it("restricts deletes on financial history rather than cascading", () => {
    const c = code(JOURNAL)
    expect(c).not.toMatch(/on delete cascade/)
    expect((c.match(/on delete restrict/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it("grants no direct write privilege to any application role", () => {
    const c = code(JOURNAL)
    for (const table of [
      "ledger_accounts", "ledger_transactions", "ledger_journal_entries", "ledger_links",
    ]) {
      expect(c, table).toContain(
        `revoke all on public.${table} from public, anon, authenticated, service_role;`
      )
      expect(c, table).toContain(`grant select on public.${table} to service_role;`)
    }
    // SELECT is the only table privilege granted, to exactly one role.
    for (const grant of code(JOURNAL).match(/^grant[^;]*;/gim) || []) {
      expect(grant.toLowerCase()).toContain("to service_role")
      expect(grant.toLowerCase()).not.toMatch(/to (public|anon|authenticated)\b/)
      if (/on public\.ledger_/.test(grant)) {
        for (const priv of ["insert", "update", "delete", "truncate", "all"]) {
          expect(grant.toLowerCase(), priv).not.toContain(priv)
        }
      }
    }
  })

  it("keeps every function search_path pinned and unexposed", () => {
    const c = code(JOURNAL)
    const fns = [...c.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1])
    expect(fns.length).toBeGreaterThanOrEqual(4)
    for (const fn of fns) {
      const start = c.indexOf(`create function public.${fn}(`)
      const header = c.slice(start, c.indexOf("as $function$", start))
      expect(header, fn).toContain("set search_path = public, pg_temp")
    }
    for (const fn of ["resolve_ledger_account", "post_ledger_transaction"]) {
      expect(c, fn).toContain(`revoke all on function public.${fn}(`)
    }
  })

  it("uses no dynamic SQL", () => {
    expect(code(JOURNAL)).not.toMatch(/execute\s+format\s*\(/i)
  })
})

/* ══ Posting function ═══════════════════════════════════════════════════════ */

describe("post_ledger_transaction", () => {
  const body = () => {
    const c = code(JOURNAL)
    return c.slice(c.indexOf("create function public.post_ledger_transaction"))
  }

  it("requires a non-blank posting key", () => {
    expect(body()).toContain("A posting key is required")
  })

  it("returns the existing transaction for an identical duplicate", () => {
    const b = body()
    expect(b).toContain("where t.posting_key = p_posting_key")
    expect(b).toContain("return query select v_existing.id, false;")
  })

  it("rejects conflicting reuse of a posting key", () => {
    expect(body()).toContain("was already used for a different economic event")
  })

  it("validates the complete line set before writing anything", () => {
    const b = body()
    expect(b).toContain("requires at least two entry lines")
    expect(b).toContain("Journal entry amounts must be positive integers")
    expect(b).toContain("side must be debit or credit")
    expect(b).toContain("is unbalanced: debits % <> credits %")

    // The validation loop must precede the first insert.
    expect(b.indexOf("is unbalanced: debits"))
      .toBeLessThan(b.indexOf("insert into public.ledger_transactions"))
  })

  it("writes transaction, lines, and links together", () => {
    const b = body()
    expect(b).toContain("insert into public.ledger_transactions")
    expect(b).toContain("insert into public.ledger_journal_entries")
    expect(b).toContain("insert into public.ledger_links")
  })
})

describe("forward ledger posting alias correction", () => {
  const correction = () => code(LEDGER_ALIAS_FIX)

  it("is a transactional replacement of the exact installed signature", () => {
    const raw = sql(LEDGER_ALIAS_FIX)
    const c = correction()
    expect(raw).toMatch(/^begin;/)
    expect(raw.trimEnd()).toMatch(/commit;$/)
    expect(c).toContain("create or replace function public.post_ledger_transaction(")
    expect(c).toContain("ledger_transaction_id uuid")
    expect(c).toContain("created boolean")
    expect(c).toContain("security definer")
    expect(c).toContain("set search_path = public, pg_temp")
    expect(c).toContain("to_regprocedure(")
    expect(c).toContain("post_ledger_transaction(text,text,text,text,uuid,text,jsonb,jsonb,text,date,timestamptz,text,text,uuid,text,integer)")
  })

  it("uses an explicit value alias for payment-link extraction", () => {
    expect(correction().replace(/\s+/g, " ")).toContain(
      "select link_item.value ->> 'payment_id' into v_payment_link from jsonb_array_elements(p_links) as link_item(value) where link_item.value ->> 'link_type' = 'payment'"
    )
  })

  it("gives every JSON array range an explicit collision-free column alias", () => {
    const calls = correction().split("\n").filter((line) => line.includes("jsonb_array_elements("))
    expect(calls).toHaveLength(9)
    for (const call of calls) expect(call).toMatch(/as (?:line_item|link_item)\(value\)/)
    expect(correction()).not.toMatch(/\bas\s+v_link\b/)
    expect(correction()).not.toMatch(/\bv_link\s+jsonb\s*;/)
    expect(correction()).toContain("v_line_item jsonb;")
    expect(correction()).toContain("v_link_item jsonb;")
  })

  it("preserves the balanced, ownership, replay, and append-only posting contract", () => {
    const c = correction()
    for (const invariant of [
      "A journal transaction requires at least two entry lines",
      "Journal transaction is unbalanced: debits % <> credits %",
      "belonging to another merchant",
      "A payment-event link must belong to the linked payment",
      "v_account.currency_or_asset <> v_currency",
      "v_account.network is distinct from v_network",
      "v_account.unit is distinct from p_unit",
      "insert into public.ledger_transactions",
      "when unique_violation then",
      "was already used with different journal lines",
      "was already used with different lifecycle links",
      "insert into public.ledger_journal_entries",
      "insert into public.ledger_links",
    ]) expect(c, invariant).toContain(invariant)
  })

  it("reasserts the exact owner and least-privilege function ACL", () => {
    const normalized = correction().replace(/\s+/g, " ")
    expect(normalized).toMatch(/alter function public\.post_ledger_transaction\([^)]+\) owner to postgres;/)
    expect(normalized).toMatch(/revoke all on function public\.post_ledger_transaction\([^)]+\) from public, anon, authenticated, service_role;/)
    expect(normalized).toMatch(/grant execute on function public\.post_ledger_transaction\([^)]+\) to service_role;/)
    expect(correction()).toContain("notify pgrst, 'reload schema';")
  })

  it("keeps the rollback-contained S05 account and merchant mismatch expectation unchanged", () => {
    const smoke = readFileSync(join(process.cwd(), "scripts", "shift4-database", "smoke-tests.sql"), "utf8")
    expect(smoke).toContain("S05 account/merchant mismatch was not rejected: %")
    expect(smoke).toContain("S05 account and merchant mismatch passed")
  })
})

/* ══ Exact money conversion ═════════════════════════════════════════════════ */

describe("exact decimal to minor units", () => {
  it("derives the authoritative payment total in SQL under lock", () => {
    const engine = readFileSync(
      join(process.cwd(), "engine", "shift4", "executeTransaction.ts"), "utf8"
    )
    const sql = code(SHIFT4)
    expect(engine).not.toContain("paymentTotalToMinorUnits(")
    expect(engine).not.toContain("paymentRequestedAmountMinor")
    expect(sql).toContain("p.gross_amount")
    expect(sql).toContain("for update")
    expect(sql).toContain("v_payment_gross * 100")
    expect(sql).toContain("trunc(v_payment_scaled)")
  })
})

/* ══ Fee policy ═════════════════════════════════════════════════════════════ */

describe("platform fee policy", () => {
  it("is defined once per payment in the Engine, not per capture", () => {
    const config = readFileSync(join(process.cwd(), "engine", "config.ts"), "utf8")
    expect(config).toContain("PINETREE_FEE = 0.15")

    const create = readFileSync(join(process.cwd(), "engine", "createPayment.ts"), "utf8")
    // The fee is fixed once, at payment creation, and stored on the payment.
    expect(create).toContain("pinetree_fee: pinetreeFee")
  })

  it("is documented as once-per-payment in the ADR", () => {
    const adr = readFileSync(
      join(process.cwd(), "docs", "architecture", "adr-0001-ledger-journal-entries.md"),
      "utf8"
    )
    expect(adr).toContain("once per overall PineTree payment")
    expect(adr).toContain("shift4.platform_fee.v1|<merchant_id>|<payment_id>")
    expect(adr).toContain("shift4.<operation>.v1|<merchant_id>|<attempt_id>")
    // The fee must not be attached to an arbitrary capture.
    expect(adr).toContain("transaction keyed by payment id")
    expect(adr).toContain("than being attached to whichever capture")
  })
})

/* ══ Journal idempotency and validation ═════════════════════════════════════ */

describe("journal idempotency and validation", () => {
  const body = () => {
    const c = code(JOURNAL)
    return c.slice(c.indexOf("create function public.post_ledger_transaction"))
  }

  it("inserts first rather than select-then-insert", () => {
    const b = body()
    // A select-then-insert race lets two concurrent callers with the same key
    // both find nothing, both insert, and one surface a raw unique_violation.
    const insert = b.indexOf("insert into public.ledger_transactions")
    const handler = b.indexOf("when unique_violation then")
    expect(insert).toBeGreaterThan(-1)
    expect(handler).toBeGreaterThan(insert)
    expect(b).toContain("for update")
  })

  it("compares the complete financial identity on a duplicate", () => {
    const b = body()
    for (const field of [
      "posting_version", "event_type", "lifecycle_domain", "merchant_id",
      "currency_or_asset", "network", "pricing_version",
      "reversal_of_transaction_id",
    ]) {
      expect(b.replace(/\s+/g, " "), field)
        .toContain(`v_existing.${field} is distinct from`)
    }
    // ...and recomputes the lines and links rather than trusting a fingerprint.
    expect(b).toContain("was already used with different journal lines")
    expect(b).toContain("was already used with different lifecycle links")
    expect(b).toContain("jsonb_agg(line order by line)")
    expect(b).toContain("jsonb_agg(link order by link)")
  })

  it("validates every account against the transaction", () => {
    const b = body()
    expect(b).toContain("which does not exist")
    expect(b).toContain("v_account.status <> 'active'")
    expect(b).toContain("is denominated in % but the transaction is in %")
    expect(b).toContain("is on network % but the transaction is on %")
  })

  it("requires a verified payment link for money postings", () => {
    const b = body()
    expect(b).toContain("requires at least one lifecycle link")
    expect(b).toContain("requires a payment link carrying payment_id")
    expect(b).toContain("which does not exist")
    expect(b).toContain("belonging to another merchant")
    expect(b).toContain("may not link to more than one payment")
    expect(b).toContain("must belong to the linked payment")
  })

  it("keeps ledger account identity immutable", () => {
    const c = code(JOURNAL)
    expect(c).toContain("create trigger ledger_accounts_identity_immutable")
    expect(c).toContain("financial identity is immutable; only status may change")
    expect(c).toContain("create trigger ledger_accounts_undeletable")
  })

  it("distinguishes the identity constraint when resolving an account", () => {
    const c = code(JOURNAL)
    expect(c).toContain("get stacked diagnostics v_violated_constraint = constraint_name;")
    const invalidDiagnosticsItem = ["pg", "exception", "constraint"].join("_")
    expect(c).not.toContain(invalidDiagnosticsItem)
    expect(c).toContain("v_violated_constraint <> 'ledger_accounts_identity_uidx'")
    // Anything else is re-raised rather than swallowed into a lookup.
    expect(c).toMatch(/\braise;/)
  })

  it("grants EXECUTE on the journal helpers to nobody", () => {
    const c = code(JOURNAL)
    // No TypeScript calls them; the Shift4 evidence function reaches them
    // through shared function ownership.
    expect(c).not.toMatch(/grant execute on function public\.(post_ledger_transaction|resolve_ledger_account)/)
    for (const fn of ["post_ledger_transaction", "resolve_ledger_account"]) {
      expect(c, fn).toContain(`revoke all on function public.${fn}(`)
    }
  })
})

/* ══ Shift4 tender-group security ═══════════════════════════════════════════ */

describe("shift4 tender groups", () => {
  it("is locked down exactly like the attempts table", () => {
    const c = code(SHIFT4)
    expect(c).toContain("alter table public.shift4_tender_groups enable row level security")
    for (const role of ["public", "anon", "authenticated", "service_role"]) {
      expect(c, role).toContain(
        `revoke all on public.shift4_tender_groups from ${role};`
      )
    }
    // No direct TypeScript read exists, so it receives no grant at all.
    expect(c).not.toMatch(/grant [a-z, ]+ on public\.shift4_tender_groups/)
  })

  it("cannot be deleted", () => {
    const c = code(SHIFT4)
    expect(c).toContain("create trigger shift4_tender_groups_undeletable")
    expect(c).toContain("are not deletable")
  })

  it("keeps its financial identity immutable", () => {
    const c = code(SHIFT4)
    expect(c).toContain("create trigger shift4_tender_groups_identity_immutable")
    expect(c).toContain("tender group identity is immutable")
  })

  it("is carried on every tender-bearing attempt", () => {
    const c = code(SHIFT4)
    expect(c).toContain("shift4_payment_attempts_tender_group_fk")
    expect(c).toMatch(/references public\.shift4_tender_groups \(id\) on delete restrict/)
    expect(c).toContain("shift4_payment_attempts_tender_group_required_check")
    expect(c).toContain("shift4_payment_attempts_tender_group_idx")
    // Persisted at creation, and inherited by children rather than re-chosen.
    expect(c).toContain("v_tender_group_id := v_authorization.tender_group_id")
    expect(c).toContain("v_chain_id, v_root_attempt_id, v_role, v_tender_group_id, v_tender_sequence,")
  })
})

/* ══ Voice Center parsing ═══════════════════════════════════════════════════ */

describe("voice center normalization", () => {
  const normalize = () =>
    readFileSync(join(process.cwd(), "providers", "shift4", "rest", "normalizeResponse.ts"), "utf8")

  it("normalizes Merchant Information voice-center fields as nullable strings", () => {
    const source = normalize()
    expect(source).toContain("voiceCenterAccountNumber: string | null")
    expect(source).toContain("voiceCenterPhoneNumber: string | null")
    expect(source).toContain("result?.merchant?.voiceCenter?.accountNumber")
    expect(source).toContain("result?.merchant?.voiceCenter?.phoneNumber")
  })

  it("treats an absent or malformed block as null rather than throwing", () => {
    const source = normalize()
    expect(source).toContain('const text = typeof value === "string" ? value.trim() : ""')
    expect(source).toContain('return text === "" ? null : text')
  })

  it("excludes both values from the general log projection", () => {
    const source = normalize()
    const start = source.indexOf("export function shift4ResultForLog")
    const projection = source.slice(start, source.indexOf("\n}", start))
    expect(projection).not.toContain("voiceCenter")
  })

  it("implements Merchant Information and Manual Authorization behind a scope gate", () => {
    const types = readFileSync(join(process.cwd(), "providers", "shift4", "rest", "types.ts"), "utf8")
    const manual = readFileSync(join(process.cwd(), "providers", "shift4", "rest", "transactions", "manualAuthorization.ts"), "utf8")
    expect(types).toContain('path: "/merchants/merchant"')
    expect(types).toContain('path: "/transactions/manualauthorization"')
    expect(manual).toContain("certificationScopeConfirmed: true")
    expect(manual).toContain("/^[A-Za-z0-9]{6}$/")
  })
})

/* ══ Runtime validation status ══════════════════════════════════════════════ */

describe("runtime validation status", () => {
  it("does not claim PostgreSQL execution", () => {
    // There is no local PostgreSQL, Docker, or Supabase CLI in this
    // environment. Every guarantee above is contract-level only, and the ADR
    // must say so rather than implying production readiness.
    const adr = readFileSync(
      join(process.cwd(), "docs", "architecture", "adr-0001-ledger-journal-entries.md"),
      "utf8"
    )
    expect(adr).toContain("not yet executed by PostgreSQL")
    expect(adr).toContain("never planned or run")
  })
})
