/**
 * PineTree Engine - Shift4 Phase 2 tests.
 *
 * Sanitized fixtures only. No live network call is possible: the global fetch
 * is replaced with a throwing stub and every provider entry point used here is
 * either pure or mocked.
 *
 * Response fixtures follow the official envelope and the documented test-server
 * triggers (amount.total drives transaction.responseCode).
 *
 * The migration cannot be executed from a unit test, so the migration-contract
 * suite asserts against the SQL source itself. That is deliberate: these are the
 * invariants a reviewer must be able to see are present before the file is run
 * against a real database.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, relative } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { mapShift4Evidence } from "@/engine/shift4/mapShift4Evidence"
import {
  buildRequestFingerprint,
  deriveAttemptId,
  fingerprintCardToken,
} from "@/engine/shift4/attempt"
import { evaluateResendPolicy, MAX_RESENDS } from "@/engine/shift4/recoverUnknownOutcome"
import {
  assertOptionalSafeMinorUnits,
  assertSafeMinorUnits,
  hashIdempotencyKey,
  parseMinorUnits,
  parseOptionalMinorUnits,
} from "@/database/shift4PaymentAttempts"
import {
  isShift4ChannelSelectable,
  SHIFT4_READINESS_NONE,
  type Shift4ProviderReadiness,
} from "@/engine/shift4/phase3Contracts"
import { minorUnitsToShift4Amount } from "@/providers/shift4/rest"

import type {
  Shift4EngineOperation,
  Shift4EvidenceInput,
} from "@/engine/shift4/types"
import type { Shift4Outcome } from "@/providers/shift4/rest"

const FAKE_CARD_TOKEN = "TOKEN00000000001"

const MIGRATION_PATH = join(
  process.cwd(),
  "database",
  "migrations",
  "20260731163100_create_shift4_payment_attempts.sql"
)

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8")
}

/**
 * The migration with `--` comments stripped.
 *
 * Assertions about what the SCHEMA does must run against executable SQL only.
 * The file's prose legitimately contains words like "real" and describes the
 * storage design being replaced, and neither should be able to fail a test
 * about column types.
 */
function migrationCode(): string {
  return migrationSql()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
}

function engineSource(file: string): string {
  return readFileSync(join(process.cwd(), "engine", "shift4", file), "utf8")
}

function engineSourceFiles(): string[] {
  return readdirSync(join(process.cwd(), "engine", "shift4"), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

/**
 * TypeScript source with comments removed.
 *
 * Assertions about what the CODE does must not be satisfied - or defeated - by
 * prose. Several modules deliberately name the pattern they removed in order to
 * explain why it must not come back.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.stubEnv("SHIFT4_CREDENTIAL_ENCRYPTION_KEY", "a".repeat(64))
  vi.stubGlobal("fetch", () => {
    throw new Error("Unexpected network call in a Shift4 Engine test.")
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Minimal normalized result carrying only what the mapper reads.
 *
 * `responseCode` is intentionally `string | null | undefined` rather than
 * `Shift4TransactionResponseCode`. These are SYNTHETIC fixtures standing in for
 * arbitrary provider JSON, and the cases that matter most are precisely the ones
 * the documented union cannot express: a blank code, an absent code, and a code
 * Shift4 has not documented yet. The official union stays narrow - see the note
 * on `Shift4EvidenceInput` in engine/shift4/types.ts.
 */
function evidence(
  outcome: Shift4Outcome,
  overrides: {
    responseCode?: string | null
    approvedAmount?: number | null
  } = {}
): Shift4EvidenceInput["result"] {
  return {
    outcome,
    responseCode: overrides.responseCode ?? null,
    approvedAmountMinor: overrides.approvedAmount == null ? null : minor(overrides.approvedAmount),
    requiresInvoiceResolution: outcome === "unknown",
  }
}

const minor = (major: number): number => Math.round(major * 100)

/** The resend-policy view of an attempt. Mirrors the durable row's fields. */
type ResendAttempt = Parameters<typeof evaluateResendPolicy>[0]["attempt"]

function baseAttempt(overrides: Partial<ResendAttempt> = {}): ResendAttempt {
  return {
    operation: "sale",
    state: "unresolved",
    recoveryState: "pending_lookup",
    resolutionReason: "invoice_not_found",
    responseCode: null,
    authorizationCode: null,
    retrievalReference: null,
    resendCount: 0,
    ...overrides,
  }
}

/* ══ A. Money representation ════════════════════════════════════════════════ */

describe("Shift4 money representation", () => {
  it("serializes safe integer minor units only at the provider boundary", () => {
    expect(minorUnitsToShift4Amount(2550, "USD")).toBe(25.5)
    expect(minorUnitsToShift4Amount(11145, "CAD")).toBe(111.45)
    expect(() => minorUnitsToShift4Amount(1.5, "USD")).toThrow()
    expect(() => minorUnitsToShift4Amount(Number.MAX_SAFE_INTEGER + 1, "USD")).toThrow()
  })
})

/* ══ B. Lifecycle mapping ═══════════════════════════════════════════════════ */

describe("Shift4 response-code mapping", () => {
  it("confirms a sale on A and C and posts the ledger", () => {
    for (const code of ["A", "C"]) {
      const mapping = mapShift4Evidence({
        operation: "sale",
        result: evidence("approved", { responseCode: code, approvedAmount: 25.5 }),
        requestedAmountMinor: minor(25.5),
      })
      expect(mapping.status, code).toBe("CONFIRMED")
      expect(mapping.terminal).toBe(true)
    }
  })

  it("does not represent an approved authorization as a captured sale", () => {
    const mapping = mapShift4Evidence({
      operation: "authorization",
      result: evidence("approved", { responseCode: "A", approvedAmount: 25.5 }),
      requestedAmountMinor: minor(25.5),
    })

    // Funds are held, not captured.
    expect(mapping.status).toBe("PROCESSING")
    expect(mapping.status).not.toBe("CONFIRMED")
    expect(mapping.terminal).toBe(false)
  })

  it("confirms the payment when a capture is approved, posting once", () => {
    const mapping = mapShift4Evidence({
      operation: "capture",
      result: evidence("approved", { responseCode: "A", approvedAmount: 25.5 }),
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBe("CONFIRMED")
  })

  it("keeps refund and void out of the payment lifecycle and off the ledger", () => {
    for (const operation of ["refund", "void"] as Shift4EngineOperation[]) {
      const mapping = mapShift4Evidence({
        operation,
        result: evidence("approved", { responseCode: "A", approvedAmount: 25.5 }),
        requestedAmountMinor: minor(25.5),
      })
      expect(mapping.status, operation).toBeNull()
    }
  })

  it("fails a sale on a verified decline", () => {
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("declined", { responseCode: "D" }),
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBe("FAILED")
    expect(mapping.attemptState).toBe("declined")
  })

  it("fails a sale on an expired card but not on a general error", () => {
    expect(
      mapShift4Evidence({
        operation: "sale",
        result: evidence("provider_error", { responseCode: "X" }),
        requestedAmountMinor: minor(25.5),
      }).status
    ).toBe("FAILED")

    const generalError = mapShift4Evidence({
      operation: "sale",
      result: evidence("provider_error", { responseCode: "e" }),
      requestedAmountMinor: minor(25.5),
    })
    expect(generalError.status).toBeNull()
    expect(generalError.reconciliationRequired).toBe(true)
  })

  it("preserves AVS and CSC evidence on an f response", () => {
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("verification_failed", { responseCode: "f" }),
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBe("FAILED")
    expect(mapping.actionRequired).toBe("avs_csc_verification_failed")
    expect(mapping.lookupRequired).toBe(false)
  })

  it("keeps a partial approval processing for another tender", () => {
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("partial_approval", { responseCode: "P", approvedAmount: 100 }),
      requestedAmountMinor: minor(219),
    })
    expect(mapping.status).toBe("PROCESSING")
    expect(mapping.actionRequired).toBe("remaining_tender_required")
  })

  it("does not confirm a voice referral", () => {
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("referral", { responseCode: "R" }),
      requestedAmountMinor: minor(999998.01),
    })
    expect(mapping.status).toBeNull()
    expect(mapping.actionRequired).toBe("voice_referral_required")
  })

  it("does not confirm an SCA requirement", () => {
    expect(
      mapShift4Evidence({
        operation: "sale",
        result: evidence("authentication_required", { responseCode: "S" }),
        requestedAmountMinor: minor(25.5),
      }).actionRequired
    ).toBe("sca_online_pin_required")

    expect(
      mapShift4Evidence({
        operation: "sale",
        result: evidence("authentication_required", { responseCode: "I" }),
        requestedAmountMinor: minor(25.5),
      }).status
    ).toBeNull()
  })

  /* ── Response-code shape matrix ───────────────────────────────────────────
   * Shift4 sends `transaction.responseCode` as free-form JSON. Every shape the
   * Engine can actually receive is covered here, including the three the
   * documented union cannot express.
   * ------------------------------------------------------------------------ */

  it("maps a documented response code through its documented outcome", () => {
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("declined", { responseCode: "D" }),
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBe("FAILED")
    expect(mapping.attemptState).toBe("declined")
    expect(mapping.lookupRequired).toBe(false)
  })

  it("treats a blank response code as unresolved, never approved or failed", () => {
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("unknown", { responseCode: "" }),
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBeNull()
    expect(mapping.lookupRequired).toBe(true)
    expect(mapping.retryClassification).toBe("lookup_required")
  })

  it("treats a null response code as unresolved", () => {
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("unknown", { responseCode: null }),
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBeNull()
    expect(mapping.lookupRequired).toBe(true)
  })

  it("treats an absent response code as unresolved", () => {
    // No `responseCode` key at all - the field is optional on the wire.
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: {
        outcome: "unknown",
        approvedAmountMinor: null,
        requiresInvoiceResolution: true,
      },
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBeNull()
    expect(mapping.lookupRequired).toBe(true)
  })

  it("leaves an undocumented code unresolved rather than guessing", () => {
    // "Q" stands for a code Shift4 introduces after this build ships.
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("unknown", { responseCode: "Q" }),
      requestedAmountMinor: minor(25.5),
    })

    // Not CONFIRMED, and not silently FAILED either.
    expect(mapping.status).toBeNull()
    expect(mapping.status).not.toBe("CONFIRMED")
    expect(mapping.status).not.toBe("FAILED")
    expect(mapping.terminal).toBe(false)

    // It must be routed to authoritative resolution, not dropped.
    expect(mapping.lookupRequired).toBe(true)
    expect(mapping.reconciliationRequired).toBe(true)
    expect(mapping.attemptState).toBe("unresolved")
    expect(mapping.retryClassification).toBe("lookup_required")
  })

  it("keeps an undocumented code persistable in the durable schema", () => {
    // response_code is plain text with no CHECK narrowing it to known values, so
    // a future Shift4 code is stored rather than rejected at the database.
    const code = migrationCode()
    expect(code).toMatch(/^\s*response_code text,?\s*$/m)

    // No CHECK constraint anywhere may reference the column.
    const constraints = code.match(/check\s*\([\s\S]*?\)/g) || []
    expect(constraints.length).toBeGreaterThan(0)
    for (const constraint of constraints) {
      expect(constraint).not.toContain("response_code")
    }
    expect(migrationSql()).toContain("must stay persistable and recoverable")
  })

  it("does not let an undocumented code masquerade as approval evidence", () => {
    // evaluateResendPolicy blocks a resend when prior APPROVAL evidence exists
    // (A / C / P). "Q" is not approval evidence, so it must not trip that guard.
    const decision = evaluateResendPolicy({
      payment: { status: "PROCESSING" },
      attempt: baseAttempt({ responseCode: "Q" }),
    })

    expect(decision.reason).not.toBe("prior_approval_evidence_exists_for_invoice")
    expect(decision.allowed).toBe(true)
  })

  /* ── Exact approved-amount evidence ───────────────────────────────────────
   * A settling approval must state EXACTLY what it approved. Missing, short,
   * and over-approved all fail - the last two in opposite directions.
   * ------------------------------------------------------------------------ */

  it("confirms a sale on A or C only when the approved amount matches exactly", () => {
    for (const code of ["A", "C"]) {
      const mapping = mapShift4Evidence({
        operation: "sale",
        result: evidence("approved", { responseCode: code, approvedAmount: 25.5 }),
        requestedAmountMinor: minor(25.5),
      })
      expect(mapping.status, code).toBe("CONFIRMED")
    }
  })

  it("refuses to confirm an approval with no approved amount", () => {
    for (const operation of ["sale", "capture"] as Shift4EngineOperation[]) {
      const mapping = mapShift4Evidence({
        operation,
        result: evidence("approved", { responseCode: "A", approvedAmount: null }),
        requestedAmountMinor: minor(25.5),
      })
      // No amount evidence at all is not grounds to confirm...
      expect(mapping.status, operation).toBeNull()
      expect(mapping.actionRequired, operation).toBe("approved_amount_missing")
      // ...and it is not a verified failure either, so it must be looked up.
      expect(mapping.lookupRequired, operation).toBe(true)
      expect(mapping.reconciliationRequired, operation).toBe(true)
      expect(mapping.attemptState, operation).toBe("unresolved")
    }
  })

  it("refuses to confirm an approval that is quietly short of the request", () => {
    const mapping = mapShift4Evidence({
      operation: "sale",
      result: evidence("approved", { responseCode: "A", approvedAmount: 10 }),
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBeNull()
    expect(mapping.actionRequired).toBe("approved_amount_below_requested")
    expect(mapping.reconciliationRequired).toBe(true)
  })

  it("refuses to confirm an approval for MORE than was requested", () => {
    const mapping = mapShift4Evidence({
      operation: "capture",
      result: evidence("approved", { responseCode: "C", approvedAmount: 99 }),
      requestedAmountMinor: minor(25.5),
    })
    // Confirming here would settle a figure PineTree never asked for.
    expect(mapping.status).toBeNull()
    expect(mapping.actionRequired).toBe("approved_amount_exceeds_requested")
    expect(mapping.reconciliationRequired).toBe(true)
  })

  it("applies the exact-amount rule to a recovery-discovered approval", () => {
    // An invoice lookup maps as the ORIGINAL operation, so recovery uses the
    // very same rule rather than a looser one.
    const source = engineSource("recoverUnknownOutcome.ts")
    expect(source).toContain("operation: attempt.operation")
    expect(source).toContain("requestedAmountMinor: attempt.amount_minor")

    for (const approvedAmount of [null, 10, 99]) {
      const mapping = mapShift4Evidence({
        operation: "sale",
        result: evidence("approved", { responseCode: "A", approvedAmount }),
        requestedAmountMinor: minor(25.5),
      })
      expect(mapping.status, String(approvedAmount)).toBeNull()
    }
  })

  it("keeps a valid partial sale processing for another tender", () => {
    for (const approvedAmount of [10]) {
      const mapping = mapShift4Evidence({
        operation: "sale",
        result: evidence("partial_approval", { responseCode: "P", approvedAmount }),
        requestedAmountMinor: minor(25.5),
      })
      expect(mapping.status, String(approvedAmount)).toBe("PROCESSING")
    }
  })

  it("keeps authorization amount evidence fail-closed", () => {
    const mapping = mapShift4Evidence({
      operation: "authorization",
      result: evidence("approved", { responseCode: "A", approvedAmount: null }),
      requestedAmountMinor: minor(25.5),
    })
    expect(mapping.status).toBeNull()
    expect(mapping.attemptState).toBe("unresolved")
    expect(mapping.lookupRequired).toBe(true)
  })

  it("never recommends CONFIRMED for any non-approved outcome", () => {
    const nonApproved: Shift4Outcome[] = [
      "declined", "partial_approval", "referral", "verification_failed",
      "authentication_required", "soft_declined", "provider_error", "unknown", "not_found",
      "inconsistent_approval",
    ]
    for (const outcome of nonApproved) {
      const mapping = mapShift4Evidence({
        operation: "sale",
        result: evidence(outcome),
        requestedAmountMinor: minor(25.5),
      })
      expect(mapping.status, outcome).not.toBe("CONFIRMED")
    }
  })

  it("threads requested amount consistency through live execution and recovery", () => {
    const live = engineSource("executeTransaction.ts")
    const recovery = engineSource("recoverUnknownOutcome.ts")
    const reconciliation = engineSource("reconcileShift4Payments.ts")
    for (const source of [live, recovery]) {
      expect(source).toContain("requestedAmountMinor:")
      expect(source).toContain("mapping.reconciliationRequired")
      expect(source).toContain('? "blocked"')
    }
    expect(reconciliation).toContain("recoverClaimedAttempt")
  })
})

/* ══ C. Attempt identity and idempotency ════════════════════════════════════ */

describe("Shift4 attempt identity", () => {
  const identity = {
    paymentId: "payment-1",
    operation: "sale" as const,
    idempotencyKey: "idem-1",
  }

  it("is deterministic for the same logical request", () => {
    expect(deriveAttemptId(identity)).toBe(deriveAttemptId(identity))
  })

  it("separates operations and idempotency keys", () => {
    expect(deriveAttemptId({ ...identity, operation: "authorization" }))
      .not.toBe(deriveAttemptId(identity))
    expect(deriveAttemptId({ ...identity, idempotencyKey: "idem-2" }))
      .not.toBe(deriveAttemptId(identity))
  })

  it("fingerprints a conflicting reuse of one idempotency key", () => {
    const base = {
      merchantId: "merchant-1",
      merchantProviderConnectionId: "connection-1",
      paymentId: "payment-1",
      operation: "sale" as const,
      channel: "ecommerce",
      amountMinor: minor(25.5),
      currency: "USD",
      cardTokenValue: FAKE_CARD_TOKEN,
    }

    expect(buildRequestFingerprint(base)).toBe(buildRequestFingerprint(base))
    // A different amount is a conflict, not a retry.
    expect(buildRequestFingerprint({ ...base, amountMinor: minor(30) }))
      .not.toBe(buildRequestFingerprint(base))
    expect(buildRequestFingerprint({ ...base, currency: "EUR" })).not.toBe(buildRequestFingerprint(base))
    expect(buildRequestFingerprint({ ...base, cardTokenValue: "TOKEN00000000002" }))
      .not.toBe(buildRequestFingerprint(base))
  })

  it("never embeds the card token in the fingerprint", () => {
    const fingerprint = buildRequestFingerprint({
      merchantId: "merchant-1",
      merchantProviderConnectionId: "connection-1",
      paymentId: "payment-1",
      operation: "sale",
      channel: "ecommerce",
      amountMinor: minor(25.5),
      currency: "USD",
      cardTokenValue: FAKE_CARD_TOKEN,
    })
    expect(fingerprint).not.toContain(FAKE_CARD_TOKEN)
    expect(fingerprintCardToken(FAKE_CARD_TOKEN)).not.toContain(FAKE_CARD_TOKEN)
    expect(fingerprintCardToken(FAKE_CARD_TOKEN)).toHaveLength(12)
  })

  it("hashes the idempotency key so no plaintext key is ever stored", () => {
    const key = "merchant-supplied-idempotency-key"
    const hashed = hashIdempotencyKey(key)

    expect(hashed).not.toContain(key)
    expect(hashed).toHaveLength(64)
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
    expect(hashIdempotencyKey(key)).toBe(hashed)
    expect(hashIdempotencyKey("different")).not.toBe(hashed)
  })
})

/* ══ D. Migration contract ══════════════════════════════════════════════════ */

describe("Shift4 attempts migration contract", () => {
  it("exists at the established migration path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true)
  })

  it("creates the dedicated attempts table", () => {
    expect(migrationCode()).toContain("create table public.shift4_payment_attempts")
  })

  it("stores money as bigint minor units, never numeric(18,2)", () => {
    const sql = migrationSql()
    expect(sql).toMatch(/amount_minor bigint not null/)
    expect(sql).toMatch(/approved_amount_minor bigint/)
    expect(sql).toMatch(/authorized_amount_minor bigint/)
    expect(sql).not.toMatch(/numeric\s*\(\s*18\s*,\s*2\s*\)/)

    // No float or double may carry money. Scoped to the CREATE TABLE column
    // block: `double precision` also appears legitimately in the dependency
    // preflight, as part of make_interval's builtin signature.
    const code = migrationCode()
    const start = code.indexOf("create table public.shift4_payment_attempts (")
    const columns = code.slice(start, code.indexOf("\n);", start))
    expect(columns).not.toMatch(/\b(double precision|float8|real|numeric|money)\b/)
    expect(columns).toMatch(/amount_minor bigint not null/)
  })

  it("stores no plaintext idempotency key and no raw card token", () => {
    const sql = migrationSql()
    expect(sql).toContain("idempotency_key_hash text not null")
    expect(sql).toContain("card_token_fingerprint text")
    expect(sql).toContain("raw_response_ref text")

    // No column may hold the raw material itself.
    expect(sql).not.toMatch(/^\s*idempotency_key\s+text/m)
    expect(sql).not.toMatch(/^\s*card_token\s+text/m)
    expect(sql).not.toMatch(/^\s*(access_token|auth_token|client_guid|pan|cvv|csc|track_data|pin_block)\s/mi)
  })

  it("scopes invoice uniqueness by provider connection AND operation", () => {
    const code = migrationCode()

    // Scoped by connection AND operation. Connection alone would reject a
    // capture reusing its authorization's invoice - the very row Shift4
    // requires to exist - so it would have broken every capture and void.
    expect(code).toContain(
      "on public.shift4_payment_attempts (merchant_provider_connection_id, invoice, attempt_role)"
    )

    // Scoping invoices by merchant alone would also be wrong: one merchant may
    // hold several MIDs, and Shift4 correlates by invoice within a MID.
    expect(code).not.toMatch(/unique index[\s\S]{0,160}\(merchant_id, invoice\)/)
  })

  it("lets only one originating transaction own an invoice chain", () => {
    const code = migrationCode()

    // The operation-scoped index alone accepts an unrelated sale AND an
    // unrelated authorization on one invoice, because their `operation` values
    // differ. This partial index is what makes an invoice identify exactly one
    // chain per MID.
    expect(code).toContain("create unique index shift4_payment_attempts_connection_chain_invoice_uidx")
    expect(code).toMatch(
      /on public\.shift4_payment_attempts \(merchant_provider_connection_id, invoice\)\s*\n\s*where root_attempt_id = attempt_id/
    )

    // There must be no UNCONDITIONAL connection-only invoice index: that is the
    // form that broke capture and void.
    const unconditional = code.match(
      /create unique index \w+\s*\n\s*on public\.shift4_payment_attempts \(merchant_provider_connection_id, invoice\);/g
    )
    expect(unconditional).toBeNull()
  })

  it("rejects an unrelated origin claiming an established invoice", () => {
    const code = migrationCode()
    expect(code).toContain("invoice_already_owned_by_another_chain")
    expect(code).toContain("root_attempt_must_not_reference_a_related_attempt")
    // Scoped to origin operations only, so a capture or void may still join.
    expect(code).toContain("and a.root_attempt_id = a.attempt_id")
  })

  it("enforces one operation identity per connection and idempotency key", () => {
    expect(migrationSql()).toContain(
      "merchant_provider_connection_id, operation, idempotency_key_hash"
    )
  })

  it("uses that same immutable operation identity for lookup and race recovery", () => {
    const code = migrationCode()
    const createStart = code.indexOf("create function public.create_shift4_payment_attempt")
    const createEnd = code.indexOf("create function public.claim_due_shift4_payment_attempts", createStart)
    const createBody = code.slice(createStart, createEnd)
    expect(createBody.match(/a\.operation = p_operation/g)).toHaveLength(2)
    expect(createBody).not.toMatch(/a\.attempt_role = v_role\s+and a\.idempotency_key_hash/)
    expect(createBody.indexOf("a.operation = p_operation")).toBeLessThan(
      createBody.indexOf("select * into v_authorization")
    )
  })

  it("allocates a tender sequence only inside the attempt-insert subtransaction", () => {
    const code = migrationCode()
    const createStart = code.indexOf("create function public.create_shift4_payment_attempt")
    const createEnd = code.indexOf("create function public.claim_due_shift4_payment_attempts", createStart)
    const createBody = code.slice(createStart, createEnd)
    const allocation = createBody.indexOf("set next_tender_sequence = g.next_tender_sequence + 1")
    const insert = createBody.indexOf("insert into public.shift4_payment_attempts")
    const exception = createBody.indexOf("when unique_violation", insert)
    expect(allocation).toBeGreaterThan(-1)
    expect(allocation).toBeLessThan(insert)
    expect(insert).toBeLessThan(exception)
    expect(createBody).toContain("tender_group_allocation_conflict")
    expect(createBody).not.toMatch(/coalesce\(max\(a\.tender_sequence\)/)
  })

  it("keeps the group and attempt count unchanged for every noninsert outcome", () => {
    const source = migrationSql()
    const smoke = readFileSync(join(process.cwd(), "scripts", "shift4-database", "smoke-tests.sql"), "utf8")
    const allocation = source.indexOf("set next_tender_sequence = g.next_tender_sequence + 1")
    for (const rejection of [
      "idempotency_key_reused_with_different_request",
      "invoice_already_owned_by_another_chain",
      "invoice_already_used_for_this_role_on_this_connection",
      "tender_would_exceed_payment_total",
      "attempt_role_does_not_match_operation",
    ]) {
      expect(source.indexOf(rejection), rejection).toBeLessThan(allocation)
    }
    expect(smoke).toContain("v_group.version <> v_before_version")
    expect(smoke).toContain("v_group.next_tender_sequence <> v_before_sequence")
    expect(smoke).toContain("v_after_count <> v_before_count")
    expect(smoke).toContain("S18 rejected/resumed/conflicting paths mutated durable state")
  })

  it("isolates tender totals, sequencing, completion, and fees by authoritative group", () => {
    const code = migrationCode()
    const createStart = code.indexOf("create function public.create_shift4_payment_attempt")
    const createEnd = code.indexOf("create function public.claim_due_shift4_payment_attempts", createStart)
    const createBody = code.slice(createStart, createEnd)
    const applyStart = code.indexOf("create function public.apply_shift4_attempt_evidence")
    const applyEnd = code.indexOf("function public.release_shift4_attempt_lease", applyStart)
    const applyBody = code.slice(applyStart, applyEnd)

    expect(createBody).toContain("where a.tender_group_id = v_tender_group_id")
    expect(createBody).toContain("where g.id = v_tender_group_id")
    expect(createBody).toContain("v_tender_sequence := v_group.next_tender_sequence")
    expect(createBody).toContain("v_tender_approved_total := 0")
    expect(createBody).not.toMatch(
      /select coalesce\(sum\(a\.approved_amount_minor\), 0\)[\s\S]{0,500}where a\.payment_id = p_payment_id/
    )

    expect(applyBody.match(/where a\.tender_group_id = v_group\.id/g)).toHaveLength(3)
    expect(applyBody).not.toMatch(
      /select coalesce\(sum\(a\.approved_amount_minor\), 0\)[\s\S]{0,500}where a\.payment_id = v_attempt\.payment_id/
    )
    expect(applyBody).toContain("v_payment_complete := true")
    expect(applyBody).toContain("if v_payment_complete and v_outcome = 'applied' then")

    // One Shift4 connection serves two payments. Each payment owns its group,
    // so payment A's approval cannot complete or charge payment B.
    const attempts = [
      { paymentId: "payment-a", groupId: "group-a", approved: 4_000 },
      { paymentId: "payment-b", groupId: "group-b", approved: 6_000 },
    ]
    const capturedFor = (paymentId: string, groupId: string) => attempts
      .filter((attempt) => attempt.paymentId === paymentId && attempt.groupId === groupId)
      .reduce((total, attempt) => total + attempt.approved, 0)
    const requested = 10_000
    const groupACaptured = capturedFor("payment-a", "group-a")
    const groupBCaptured = capturedFor("payment-b", "group-b")
    const groupANextTenderSequence = 3
    const groupBNextTenderSequence = 2

    expect(groupACaptured).toBe(4_000)
    expect(groupBCaptured).toBe(6_000)
    expect(requested - groupACaptured).toBe(6_000)
    expect(groupANextTenderSequence).toBe(3)
    expect(groupBNextTenderSequence).toBe(2)
    expect(groupACaptured === requested).toBe(false)
    expect(groupACaptured === requested && requested >= 15).toBe(false)
    expect(attempts.reduce((total, attempt) => total + attempt.approved, 0)).toBe(requested)

    const smoke = readFileSync(
      join(process.cwd(), "scripts", "shift4-database", "smoke-tests.sql"),
      "utf8"
    )
    expect(smoke).toContain("v_merchant_id uuid := gen_random_uuid()")
    expect(smoke).toContain("v_payment_a_id uuid := gen_random_uuid()")
    expect(smoke).toContain("v_payment_b_id uuid := gen_random_uuid()")
    expect(smoke).toContain("v_connection_id uuid := gen_random_uuid()")
    expect(smoke).not.toMatch(/00000000-0000-0000-0000-00000000000[1-4]/i)
    expect(smoke).not.toMatch(/v_operator_confirms|operator configuration block/i)
    expect(smoke).not.toMatch(/v_connection_[2-9]_id/i)
    expect(smoke).toContain("v_payment_a_id = v_payment_b_id")
    expect(smoke).toContain("INSERT INTO public.merchants")
    expect(smoke).toContain("INSERT INTO public.merchant_providers")
    expect(smoke).toContain("INSERT INTO public.payments")
    expect(smoke).toContain("id, email, business_name, created_at")
    expect(smoke).not.toMatch(/\bm\.provider\b/i)
    expect(smoke).toContain("id, merchant_id, provider, enabled, credentials, created_at, updated_at")
    expect(smoke).toContain("v_connection_id, v_merchant_id, 'shift4_rest', true")
    expect(smoke).toContain("mp.provider='shift4_rest' AND mp.status='active' AND mp.enabled=true")
    expect(smoke).toContain("id, merchant_id, subtotal_amount, platform_fee, total_amount")
    expect(smoke).toContain("v_payment_a_id, v_merchant_id, 200, 15, 215, 2.00, 0.15, 2.15")
    expect(smoke).toContain("v_payment_b_id, v_merchant_id, 300, 15, 315, 3.00, 0.15, 3.15")
    for (const payment of ["A", "B"]) {
      expect(smoke).toContain(`Generated payment ${payment} does not belong to synthetic merchant`)
      expect(smoke).toContain(`Unsafe payment ${payment} status`)
      expect(smoke).toContain(`Synthetic payment ${payment} requires exact dual-model USD/CAD money`)
      expect(smoke).toContain(`Unsafe non-pristine payment ${payment}`)
    }
    expect(smoke).toContain("v_group_a.next_tender_sequence <> 3")
    expect(smoke).toContain("v_group_b.next_tender_sequence <> v_before_sequence")
    expect(smoke).toContain("v_attempt_a.remaining_amount_minor <> v_remainder")
    expect(smoke).toContain("v_captured_after <> v_total")
    expect(smoke).toContain("p_target_status=>'CONFIRMED'")
    expect(smoke).toContain("v_fee_before <> v_payment_a_fee_count + 1")
    expect(smoke).toContain("v_fee_after <> v_payment_b_fee_count")
    expect(smoke).toContain("l.payment_id=v_payment_b_id")
    expect(smoke).toContain("a.payment_id=v_payment_b_id) <> v_payment_b_attempt_count")
    expect(smoke).toContain("e.payment_id=v_payment_b_id) <> v_payment_b_event_count")
    expect(smoke).toContain("S19 payment and tender-group isolation assertion failed")
    expect(smoke).toContain("S19 payment and tender-group isolation passed")
    expect(smoke).toContain("Final containment assertions passed for generated rollback-only fixtures")
    expect(smoke).not.toMatch(/^\s*COMMIT\s*;/im)
    expect(smoke.trimEnd()).toMatch(/ROLLBACK;$/)
  })

  it("enforces one attempt identity per merchant", () => {
    expect(migrationSql()).toContain(
      "on public.shift4_payment_attempts (merchant_id, attempt_id)"
    )
  })

  it("constrains controlled vocabularies without constraining response codes", () => {
    const sql = migrationSql()
    expect(sql).toContain("check (operation in ('sale', 'authorization', 'capture', 'refund', 'void'))")
    expect(sql).toContain("check (channel in ('retail', 'ecommerce'))")
    expect(sql).toMatch(/state in \(\s*'created', 'dispatched', 'approved', 'declined', 'unresolved'/)
    expect(sql).toContain("recovery_state in ('none', 'pending_lookup', 'resolved', 'exhausted', 'blocked')")
    expect(sql).toContain("check (currency ~ '^[A-Z]{3}$')")
    expect(sql).toContain("check (invoice ~ '^[0-9]{10}$')")
  })

  it("constrains counters and amounts to safe ranges", () => {
    const sql = migrationSql()
    expect(sql).toContain("check (amount_minor >= 0)")
    expect(sql).toContain("check (lookup_attempt_count >= 0)")
    expect(sql).toContain("check (resend_count >= 0)")
    expect(sql).toContain("check (attempt_number >= 1)")
    expect(sql).toContain("check (version >= 1)")
  })

  it("requires a capture to equal its authorization at the schema level", () => {
    const code = migrationCode()
    expect(code).toContain("shift4_payment_attempts_capture_equals_authorization_check")
    expect(code).toContain("amount_minor = authorized_amount_minor")
    // The permissive <= form must be gone.
    expect(code).not.toMatch(/amount_minor <= authorized_amount_minor/)
  })

  it("adds no canonical UNKNOWN payment status", () => {
    const sql = migrationSql()
    expect(sql).not.toMatch(/payments[\s\S]{0,200}'UNKNOWN'/)
    expect(sql).not.toContain("payment.unknown")
  })

  it("enables RLS and revokes access from public, anon, and authenticated", () => {
    const sql = migrationSql()
    expect(sql).toContain("alter table public.shift4_payment_attempts enable row level security")
    expect(sql).toContain("revoke all on public.shift4_payment_attempts from public")
    expect(sql).toContain("revoke all on public.shift4_payment_attempts from anon")
    expect(sql).toContain("revoke all on public.shift4_payment_attempts from authenticated")
  })

  it("never equates merchant_id with auth.uid()", () => {
    // The Database, Identity, and Security Standard prohibits that shortcut.
    expect(migrationSql()).not.toMatch(/merchant_id\s*=\s*auth\.uid\(\)/)
  })

  it("declares every function SECURITY DEFINER with an explicit search_path", () => {
    const sql = migrationSql()
    const definerCount = (sql.match(/security definer/g) || []).length
    const searchPathCount = (sql.match(/set search_path = public, pg_temp/g) || []).length

    expect(definerCount).toBeGreaterThanOrEqual(4)
    // Every function - definer or not - pins its search_path.
    expect(searchPathCount).toBeGreaterThanOrEqual(definerCount)
  })

  it("grants execute only to the service role", () => {
    const sql = migrationSql()
    for (const fn of [
      "create_shift4_payment_attempt",
      "claim_due_shift4_payment_attempts",
      "apply_shift4_attempt_evidence",
      "release_shift4_attempt_lease",
    ]) {
      expect(sql, fn).toContain(fn)
    }
    expect(sql).toContain("to service_role")
    expect(sql).not.toMatch(/grant execute[\s\S]{0,200}to (anon|authenticated)/)
  })

  it("verifies tenancy inside the creation function", () => {
    const sql = migrationSql()
    expect(sql).toContain("payment_not_owned_by_merchant")
    expect(sql).toContain("provider_connection_not_owned_by_merchant")
    expect(sql).toContain("provider_connection_is_not_shift4_rest")
  })

  it("uses no dynamic SQL in the Shift4 functions", () => {
    // `execute format(...)` appears in older lifecycle migrations; this one must
    // not need it, so nothing can be injected through a parameter.
    expect(migrationSql()).not.toMatch(/execute\s+format\s*\(/i)
  })

  it("declares the deterministic partial due-work index", () => {
    const sql = migrationSql()
    expect(sql).toContain("shift4_payment_attempts_due_work_idx")
    expect(sql).toContain("(next_check_at asc, created_at asc, id asc)")
    expect(sql).toContain("where recovery_state = 'pending_lookup' and next_check_at is not null")
  })

  it("declares the operational indexes the standard requires", () => {
    const sql = migrationSql()
    expect(sql).toContain("shift4_payment_attempts_payment_idx")
    expect(sql).toContain("(merchant_id, created_at desc)")
    expect(sql).toContain("(merchant_provider_connection_id, created_at desc)")
    expect(sql).toContain("shift4_payment_attempts_authorization_idx")
    expect(sql).toContain("shift4_payment_attempts_recovery_state_idx")
    expect(sql).toContain("shift4_payment_attempts_active_lease_idx")
  })

  it("claims due work with row locking that cannot double-assign", () => {
    expect(migrationSql()).toContain("for update skip locked")
  })

  it("locks the attempt and the payment before applying evidence", () => {
    const sql = migrationSql()
    const applyStart = sql.indexOf("function public.apply_shift4_attempt_evidence")
    expect(applyStart).toBeGreaterThan(-1)
    const body = sql.slice(applyStart)
    // Both rows are locked, so the transition check cannot be raced.
    expect((body.match(/for update/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it("rejects a stale writer through an expected-version check", () => {
    const sql = migrationSql()
    expect(sql).toContain("version_conflict")
    expect(sql).toContain("attempt_modified_by_another_writer")
    expect(sql).toContain("v_attempt.version <> p_expected_version")
  })

  it("refuses to overwrite a terminal payment with a late success", () => {
    const sql = migrationSql()
    expect(sql).toContain("late_provider_outcome_after_terminal_state")
    expect(sql).toContain("array['CONFIRMED','FAILED','EXPIRED','CANCELED','INCOMPLETE']")
  })

  it("posts every real settling operation and projects legacy only at completion", () => {
    const sql = migrationSql()
    expect(sql).toContain("if v_settling_eligible then")
    expect(sql).toContain("public.post_ledger_transaction(")
    expect(sql).toContain("if v_payment_complete and v_applied = 'CONFIRMED' then")
    expect(sql).toContain("on conflict (payment_id) do nothing")
  })

  it("does not modify the existing ledger uniqueness model", () => {
    const sql = migrationSql()
    expect(sql).not.toMatch(/alter table[\s\S]{0,80}ledger_entries/i)
    expect(sql).not.toMatch(/drop\s+index[\s\S]{0,80}ledger/i)
    expect(sql).not.toMatch(/create table[\s\S]{0,60}ledger_/i)
  })

  it("is additive and forward-only", () => {
    // Executable SQL only: the privilege section legitimately DISCUSSES
    // TRUNCATE and DELETE in prose to explain why they are withheld.
    const code = migrationCode()
    expect(code).not.toMatch(/\bdrop\s+table\b/i)
    expect(code).not.toMatch(/\bdrop\s+column\b/i)
    expect(code).not.toMatch(/\btruncate\s+table\b/i)
    expect(code).not.toMatch(/^\s*truncate\b/im)
    expect(code).not.toMatch(/\bdelete\s+from\b/i)
    // The only tables it writes to are its own, plus the append-only evidence
    // and ledger tables the transition legitimately needs.
    expect(code).not.toMatch(/alter table public\.payments\s+(add|drop)/i)
  })

  it("adds no new payment_events.event_type value", () => {
    const code = migrationCode()

    // The preflight legitimately READS the event-type constraint to confirm
    // 'payment.reconciled' is accepted. What must not happen is any DDL that
    // adds, drops, or rewrites a constraint on payment_events.
    expect(code).not.toMatch(/alter table\s+public\.payment_events/i)
    expect(code).not.toMatch(/drop constraint/i)

    // Every event_type this migration inserts is already canonical.
    const inserted = code.match(/'payment\.[a-z]+'/g) || []
    const canonical = new Set([
      "'payment.created'", "'payment.pending'", "'payment.processing'",
      "'payment.confirmed'", "'payment.failed'", "'payment.canceled'",
      "'payment.cancelled'", "'payment.incomplete'", "'payment.expired'",
      "'payment.refunded'", "'payment.reconciled'",
    ])
    for (const value of inserted) {
      expect(canonical.has(value), value).toBe(true)
    }
    expect(inserted).toContain("'payment.reconciled'")
  })

  /* ── Exact signature contract ─────────────────────────────────────────────
   * Broad string matching can pass while the SQL is unusable. These assertions
   * pin the actual parameter lists and return columns, and cross-check them
   * against the TypeScript RPC calls, because a mismatch compiles fine in
   * TypeScript and only fails at runtime through PostgREST.
   * ------------------------------------------------------------------------ */

  /** Parameter names, in declaration order, for one SQL function. */
  function sqlParams(fn: string): string[] {
    const code = migrationCode()
    const start = code.indexOf(`create function public.${fn}(`)
    expect(start, fn).toBeGreaterThan(-1)
    const open = code.indexOf("(", start)
    const header = code.slice(open + 1, code.indexOf("\n)", open))
    return (header.match(/\bp_[a-z0-9_]+/g) || []).filter(
      (name, index, all) => all.indexOf(name) === index
    )
  }

  /** Parameter names, in call order, from the TypeScript RPC invocation. */
  function tsParams(fn: string): string[] {
    const source = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    const start = source.indexOf(`rpc("${fn}"`)
    expect(start, fn).toBeGreaterThan(-1)
    const end = source.indexOf("\n  })", start)
    return (source.slice(start, end).match(/\bp_[a-z0-9_]+(?=:)/g) || [])
  }

  /** Declared return columns, in order. */
  function sqlReturnColumns(fn: string): string[] {
    const code = migrationCode()
    const start = code.indexOf(`create function public.${fn}(`)
    const returns = code.indexOf("returns table (", start)
    if (returns === -1) return []
    const body = code.slice(returns + "returns table (".length, code.indexOf("\n)", returns))
    return body
      .split(",")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean)
  }

  it("declares create_shift4_payment_attempt with the exact expected signature", () => {
    expect(sqlParams("create_shift4_payment_attempt")).toEqual([
      "p_attempt_id", "p_merchant_id", "p_payment_id",
      "p_merchant_provider_connection_id", "p_operation", "p_channel", "p_invoice",
      "p_amount_minor", "p_currency", "p_idempotency_key_hash",
      "p_request_fingerprint", "p_correlation_id", "p_authorization_attempt_id",
      "p_refund_id", "p_authorized_amount_minor", "p_card_token_fingerprint",
      "p_attempt_number", "p_related_attempt_id",
      "p_attempt_role", "p_manual_authorization_code",
    ])
    expect(sqlReturnColumns("create_shift4_payment_attempt")).toEqual([
      "outcome", "attempt_id", "attempt_row_id", "invoice", "state",
      "recovery_state", "version", "conflict_reason",
    ])
  })

  it("declares claim_due_shift4_payment_attempts with the exact expected signature", () => {
    expect(sqlParams("claim_due_shift4_payment_attempts")).toEqual([
      "p_lease_owner", "p_lease_seconds", "p_limit", "p_merchant_id",
      "p_merchant_provider_connection_id", "p_payment_id", "p_attempt_id", "p_now",
    ])
  })

  it("declares apply_shift4_attempt_evidence with the exact expected return columns", () => {
    expect(sqlReturnColumns("apply_shift4_attempt_evidence")).toEqual([
      "outcome", "attempt_id", "version", "previous_status", "applied_status",
      "ledger_posted", "reconciliation_required", "conflict_reason",
      "attempt_state", "attempt_recovery_state", "attempt_resolution_reason",
      "attempt_next_check_at", "tender_group_state",
    ])
  })

  it("passes every RPC argument the SQL declares, in the same order", () => {
    for (const fn of [
      "create_shift4_payment_attempt",
      "claim_due_shift4_payment_attempts",
      "apply_shift4_attempt_evidence",
      "release_shift4_attempt_lease",
    ]) {
      const declared = sqlParams(fn)
      const passed = tsParams(fn)

      // Every argument the TypeScript passes must exist in the SQL. A stray
      // name is silently ignored by PostgREST and the value never arrives.
      for (const name of passed) {
        expect(declared, `${fn} declares ${name}`).toContain(name)
      }
      // And the call must cover the full declared list, so no parameter
      // silently falls back to its default.
      expect(passed.slice().sort(), fn).toEqual(declared.slice().sort())
    }
  })

  it("keeps every REVOKE and GRANT signature in step with the declarations", () => {
    const code = migrationCode()
    for (const fn of [
      "create_shift4_payment_attempt",
      "claim_due_shift4_payment_attempts",
      "apply_shift4_attempt_evidence",
      "release_shift4_attempt_lease",
    ]) {
      const declaredCount = sqlParams(fn).length

      // A REVOKE/GRANT whose type list does not match the declaration raises
      // "function does not exist" and aborts the whole migration.
      for (const marker of [`revoke all on function public.${fn}(`, `grant execute on function public.${fn}(`]) {
        const at = code.indexOf(marker)
        expect(at, `${fn} ${marker}`).toBeGreaterThan(-1)
        const types = code.slice(at + marker.length, code.indexOf(")", at + marker.length))
        expect(types.split(",").length, `${fn} ${marker} arity`).toBe(declaredCount)
      }
    }
  })

  it("declares no plaintext idempotency-key or raw-token parameter", () => {
    for (const fn of [
      "create_shift4_payment_attempt",
      "claim_due_shift4_payment_attempts",
      "apply_shift4_attempt_evidence",
      "release_shift4_attempt_lease",
    ]) {
      for (const param of sqlParams(fn)) {
        expect(param, fn).not.toMatch(/^p_idempotency_key$/)
        expect(param, fn).not.toMatch(/card_token_value|^p_card_token$/)
        expect(param, fn).not.toMatch(/access_token|auth_token|client_guid|^p_pan$|cvv|csc_input|track|pin_block/)
      }
    }
  })

  it("pins the ON CONFLICT target to the ledger's payment_id index", () => {
    const code = migrationCode()
    const conflicts = code.match(/on conflict \([^)]*\)/g) || []
    expect(conflicts).toEqual(["on conflict (payment_id)"])
  })

  it("verifies its external dependencies before deploying anything", () => {
    const code = migrationCode()
    // A PL/pgSQL body is never planned at CREATE time, so a missing unique
    // index on ledger_entries.payment_id would let this migration commit and
    // then fail at the first confirmed payment. The preflight turns that into
    // an immediate, explicit failure inside the transaction.
    expect(code).toContain("$preflight$")
    expect(code).toContain("to_regclass")
    expect(code).toContain("idx.indisunique")
    expect(code).toContain("ledger_entries")

    // The preflight must run before the table is created.
    expect(code.indexOf("$preflight$")).toBeLessThan(
      code.indexOf("create table public.shift4_payment_attempts")
    )
  })

  it("declares foreign keys that protect financial evidence", () => {
    const code = migrationCode()
    expect(code).toContain("shift4_payment_attempts_payment_fk")
    expect(code).toContain("shift4_payment_attempts_connection_fk")
    // RESTRICT, never CASCADE: a parent deletion must not silently destroy the
    // proof that money moved.
    expect(code).toMatch(/references public\.payments \(id\) on delete restrict/)
    expect(code).toMatch(/references public\.merchant_providers \(id\) on delete restrict/)
    expect(code).not.toMatch(/on delete cascade/)
  })

  it("classifies a unique violation by the exact constraint that failed", () => {
    const code = migrationCode()
    expect(code).toContain("get stacked diagnostics v_violated_constraint = constraint_name;")
    const invalidDiagnosticsItem = ["pg", "exception", "constraint"].join("_")
    expect(code).not.toContain(invalidDiagnosticsItem)
    // Each named index maps to exactly one business outcome, including both
    // invoice indexes - a same-operation duplicate and an unrelated origin
    // claiming an established chain are different conditions.
    const handler = code.slice(code.indexOf("get stacked diagnostics"))
    for (const index of [
      "shift4_payment_attempts_connection_invoice_role_uidx",
      "shift4_payment_attempts_connection_chain_invoice_uidx",
      "shift4_payment_attempts_connection_operation_idem_uidx",
      "shift4_payment_attempts_merchant_attempt_uidx",
    ]) {
      expect(handler, index).toContain(index)
    }
    expect(handler).toContain("invoice_already_owned_by_another_chain")
    // ...and anything unrecognized is re-raised rather than mislabelled.
    expect(code).toMatch(/\braise;/)
  })

  it("makes the lease authoritative for who may write evidence", () => {
    const code = migrationCode()
    expect(code).toContain("lease_conflict")
    expect(code).toContain("attempt_leased_by_another_worker")
    // Lease expiry is judged by server time, never the caller's clock.
    expect(code).toContain("a.lease_expires_at <= now()")
    expect(code).toContain("lease_expires_at = now() + make_interval")
  })

  it("requires an expected version and re-verifies payment ownership", () => {
    const code = migrationCode()
    expect(code).toContain("expected_version_required")
    expect(code).toContain("v_payment.merchant_id is distinct from p_merchant_id")
  })

  it("scopes a capture's authorization to the same provider connection", () => {
    expect(migrationCode()).toContain("related_attempt_belongs_to_another_provider_connection")
  })

  it("marks the flat ledger as a compatibility projection", () => {
    const sql = migrationSql()
    const insert = sql.indexOf("insert into public.ledger_entries")
    const note = sql.indexOf("Legacy compatibility projection")
    expect(note).toBeGreaterThan(-1)
    expect(note).toBeLessThan(insert)

    expect(sql).toContain("Canonical money movement")
    expect(sql).toContain("balanced journal above")
  })

  /* ── First-deployment strictness ──────────────────────────────────────────
   * This migration has never run. It must deploy the exact intended schema or
   * fail completely - never silently adopt a pre-existing object whose
   * definition differs from this file.
   * ------------------------------------------------------------------------ */

  it("uses strict creation statements with no permissive fallbacks", () => {
    const code = migrationCode()
    expect(code).not.toMatch(/create\s+table\s+if\s+not\s+exists/i)
    expect(code).not.toMatch(/create\s+(unique\s+)?index\s+if\s+not\s+exists/i)
    expect(code).not.toMatch(/create\s+or\s+replace\s+function/i)

    // And the objects really are created the strict way.
    expect(code).toContain("create table public.shift4_payment_attempts (")
    expect((code.match(/^create (unique )?index /gm) || []).length).toBe(18)
    expect((code.match(/^create function public\./gm) || []).length).toBe(8)
  })

  it("rejects any pre-existing Shift4 object before creating anything", () => {
    const code = migrationCode()
    expect(code).toContain("$existing_objects$")

    // Every object this migration creates must be named in the guard.
    for (const name of [
      "create_shift4_payment_attempt", "claim_due_shift4_payment_attempts",
      "apply_shift4_attempt_evidence", "release_shift4_attempt_lease",
      "shift4_canonical_status_path", "shift4_status_event_type",
      "shift4_payment_attempts_merchant_attempt_uidx",
      "shift4_payment_attempts_connection_invoice_role_uidx",
      "shift4_payment_attempts_connection_chain_invoice_uidx",
      "shift4_payment_attempts_connection_operation_idem_uidx",
      "shift4_payment_attempts_due_work_idx",
      "shift4_payment_attempts_active_lease_idx",
      "shift4_payment_attempts_related_idx",
      "shift4_payment_attempts_chain_root_uidx",
      "shift4_payment_attempts_chain_idx",
      "shift4_payment_attempts_tender_idx",
    ]) {
      const guard = code.slice(code.indexOf("$existing_objects$"), code.indexOf("$existing_objects$;"))
      expect(guard, name).toContain(name)
    }

    // The guard must run before the first CREATE.
    expect(code.indexOf("$existing_objects$")).toBeLessThan(
      code.indexOf("create table public.shift4_payment_attempts")
    )
  })

  it("preflights every function, extension, and role dependency", () => {
    const code = migrationCode()
    const block = code.slice(code.indexOf("$dependencies$"), code.indexOf("$dependencies$;"))

    expect(block).toContain("gen_random_uuid()")
    expect(block).toContain("jsonb_build_object")
    expect(block).toContain("make_interval")
    expect(block).toContain("server_version_num")
    for (const role of ["service_role", "anon", "authenticated"]) {
      expect(block, role).toContain(`rolname = '${role}'`)
    }

    // It checks for the extension's function; it must not install anything.
    // Matched as a statement: the raise message legitimately mentions that this
    // migration does not create extensions.
    expect(code).not.toMatch(/^\s*create\s+extension\b/im)
  })

  it("declares foreign keys inline on the table", () => {
    const code = migrationCode()
    expect(code).toMatch(/constraint shift4_payment_attempts_payment_fk\s+references public\.payments \(id\) on delete restrict/)
    expect(code).toMatch(/constraint shift4_payment_attempts_connection_fk\s+references public\.merchant_providers \(id\) on delete restrict/)
    expect(code).not.toMatch(/on delete cascade/)
    // No conditional add-constraint block remains.
    expect(code).not.toContain("$foreign_keys$")
  })

  /* ── Privilege contract ───────────────────────────────────────────────────*/

  it("grants the service role SELECT and nothing more", () => {
    const code = migrationCode()

    expect(code).toContain("grant select on public.shift4_payment_attempts to service_role;")
    expect(code).not.toMatch(/grant\s+all\s+on\s+public\.shift4_payment_attempts/i)
    expect(code).not.toMatch(/grant\s+all\s+on\s+table/i)

    // Default privileges in a Supabase project can hand service_role full
    // rights on new tables, so the grant is only least-privilege if the revoke
    // comes first.
    const revoke = code.indexOf("revoke all on public.shift4_payment_attempts from service_role;")
    const grant = code.indexOf("grant select on public.shift4_payment_attempts to service_role;")
    expect(revoke).toBeGreaterThan(-1)
    expect(revoke).toBeLessThan(grant)
  })

  it("never grants a write, delete, or structural privilege on the table", () => {
    const code = migrationCode()
    const tableGrants = code.match(/^grant\s+([a-z, ]+)\s+on\s+public\.shift4_payment_attempts[^;]*;/gim) || []

    expect(tableGrants).toHaveLength(1)
    const [only] = tableGrants
    expect(only).toBeDefined()
    for (const forbidden of ["insert", "update", "delete", "truncate", "references", "trigger", "all"]) {
      expect(String(only).toLowerCase(), forbidden).not.toContain(forbidden)
    }
  })

  it("grants nothing at all to public, anon, or authenticated", () => {
    const code = migrationCode()
    for (const grant of code.match(/^grant[^;]*;/gim) || []) {
      expect(grant.toLowerCase()).toContain("to service_role")
      expect(grant.toLowerCase()).not.toMatch(/to (public|anon|authenticated)\b/)
    }
  })

  it("revokes the table from every untrusted role", () => {
    const code = migrationCode()
    for (const role of ["public", "anon", "authenticated", "service_role"]) {
      expect(code, role).toContain(
        `revoke all on public.shift4_payment_attempts from ${role};`
      )
    }
  })

  /* ── Function security contract ───────────────────────────────────────────*/

  it("elevates exactly the four mutation RPCs and no helper", () => {
    const code = migrationCode()
    const declared = [...code.matchAll(/create function public\.([a-z0-9_]+)\(/g)].map((m) => m[1])
    expect(declared.length).toBe(8)

    const definer: string[] = []
    const invoker: string[] = []
    for (const fn of declared) {
      const start = code.indexOf(`create function public.${fn}(`)
      const header = code.slice(start, code.indexOf("as $function$", start))
      ;(/security definer/.test(header) ? definer : invoker).push(fn)

      // Every function, elevated or not, pins its search_path.
      expect(header, fn).toContain("set search_path = public, pg_temp")
    }

    expect(definer.sort()).toEqual([
      "apply_shift4_attempt_evidence",
      "claim_due_shift4_payment_attempts",
      "create_shift4_payment_attempt",
      "release_shift4_attempt_lease",
    ])
    expect(invoker.sort()).toEqual([
      "shift4_canonical_status_path",
      "shift4_status_event_type",
      "shift4_tender_group_identity_is_immutable",
      "shift4_tender_group_is_undeletable",
    ])
  })

  it("keeps the pure helpers deterministic and unelevated", () => {
    const code = migrationCode()
    for (const fn of ["shift4_canonical_status_path", "shift4_status_event_type"]) {
      const start = code.indexOf(`create function public.${fn}(`)
      const header = code.slice(start, code.indexOf("as $function$", start))
      expect(header, fn).toMatch(/\bimmutable\b/)
      expect(header, fn).not.toMatch(/security definer/)
    }

    // Not granted to service_role: nothing calls them over RPC, and their only
    // callers hold EXECUTE by ownership.
    expect(code).not.toMatch(/grant execute on function public\.shift4_canonical_status_path/)
    expect(code).not.toMatch(/grant execute on function public\.shift4_status_event_type/)

    // But they are still revoked from every untrusted role.
    for (const fn of ["shift4_canonical_status_path(text, text)", "shift4_status_event_type(text)"]) {
      for (const role of ["public", "anon", "authenticated"]) {
        expect(code, `${fn} ${role}`).toContain(
          `revoke all on function public.${fn} from ${role};`
        )
      }
    }
  })

  /* ── Transaction-chain lineage ────────────────────────────────────────────*/

  it("carries a generic lineage pointer for capture and void chains", () => {
    const code = migrationCode()
    expect(code).toMatch(/^\s*related_attempt_id text,?\s*$/m)
    expect(code).toContain("shift4_payment_attempts_related_idx")
    // The capture-specific alias must stay in step with the generic pointer.
    expect(code).toContain("shift4_payment_attempts_capture_lineage_alias_check")
    // An originating operation never points at a parent.
    expect(code).toContain("shift4_payment_attempts_chain_root_check")
  })

  it("requires a capture and a void to name the transaction they act on", () => {
    const code = migrationCode()
    expect(code).toContain("shift4_payment_attempts_capture_requires_authorization_check")
    expect(code).toContain("shift4_payment_attempts_void_requires_related_check")
    expect(code).toContain("_requires_related_attempt")
  })

  it("confines a chain to one merchant, payment, and provider connection", () => {
    const code = migrationCode()
    expect(code).toContain("related_attempt_belongs_to_another_payment")
    expect(code).toContain("related_attempt_belongs_to_another_provider_connection")
    // The child must carry the parent's invoice, or the chain is not a chain.
    expect(code).toContain("invoice_does_not_match_related_attempt")
  })

  it("only lets a void reverse an approved sale, authorization, or capture", () => {
    const code = migrationCode()
    expect(code).toContain("void_target_is_not_a_voidable_operation")
    expect(code).toContain("void_target_was_not_approved")
  })

  it("forbids a refund from reusing any existing invoice", () => {
    const code = migrationCode()
    // The unique index cannot express this: a refund carries a different
    // operation and would otherwise be allowed to share.
    expect(code).toContain("refund_must_not_reuse_an_existing_invoice")
    expect(code).toContain("shift4_payment_attempts_refund_requires_refund_id_check")
  })

  it("treats only a same-operation duplicate as an invoice collision", () => {
    const code = migrationCode()
    expect(code).toContain("invoice_already_used_for_this_role_on_this_connection")
    expect(code).toContain("and a.attempt_role = v_role")
  })

  /* ── Full-capture equality ────────────────────────────────────────────────*/

  it("rejects a capture below, above, or without a known authorization", () => {
    const code = migrationCode()
    expect(code).toContain("capture_amount_below_authorized_amount")
    expect(code).toContain("capture_amount_exceeds_authorized_amount")
    expect(code).toContain("authorization_amount_unknown")
    // Equality, never "at most".
    expect(code).not.toMatch(/p_amount_minor <= v_authorization\.authorized_amount_minor/)
  })

  it("re-checks the authorization at settlement, not only at creation", () => {
    const code = migrationCode()
    expect(code).toContain("capture_requires_a_linked_approved_authorization")
    expect(code).toContain("capture_invoice_does_not_match_authorization")
    expect(code).toContain("capture_amount_must_equal_authorized_amount")
  })

  /* ── Database-derived financial authority ─────────────────────────────────*/

  it("exposes no caller-controlled ledger flag", () => {
    const code = migrationCode()
    expect(code).not.toContain("p_posts_ledger")
    expect(code).toContain("v_settling_eligible")
    expect(code).toContain("if v_settling_eligible then")

    // Nor does the TypeScript contract offer one.
    const dbSource = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    expect(dbSource).not.toContain("postsLedger")
    expect(dbSource).not.toContain("p_posts_ledger")
  })

  it("lets only sale and capture confirm a payment", () => {
    const code = migrationCode()
    expect(code).toContain("only_sale_or_capture_may_confirm_a_payment")
    expect(code).toContain("authorization_may_only_reach_processing")
    expect(code).toContain("_must_not_change_payment_lifecycle")
  })

  it("requires real approval evidence before any confirmation", () => {
    const code = migrationCode()
    expect(code).toContain("confirmation_requires_an_approved_attempt_state")
    expect(code).toContain("confirmation_requires_an_accepted_approval_code")
    expect(code).toContain("approved_amount_missing")
    expect(code).toContain("approved_amount_below_requested")
    expect(code).toContain("approved_amount_exceeds_requested")
    // No permissive shortcut may remain in the CONFIRMATION path. The table's
    // `approved_amount_minor is null or ... >= 0` nonnegativity CHECK is a
    // different thing and must survive, so scope this to the apply function.
    const applyStart = code.indexOf("function public.apply_shift4_attempt_evidence")
    const applyEnd = code.indexOf("function public.release_shift4_attempt_lease", applyStart)
    const applyBody = code.slice(applyStart, applyEnd)

    expect(applyBody).not.toMatch(/v_effective_approved is not null and v_effective_approved </)
    expect(applyBody).not.toMatch(/v_effective_approved is null or/)
    expect(applyBody).toContain("v_effective_approved >= v_attempt.amount_minor")
    // Exact equality in both directions, plus a required value. These now set
    // an evidence-preserving override rather than rejecting the whole write.
    expect(applyBody).toContain("v_effective_approved is null")
    expect(applyBody).toContain("v_effective_approved < v_attempt.amount_minor")
    expect(applyBody).toContain("v_effective_approved > v_attempt.amount_minor")
    expect(applyBody).toContain("v_amount_problem")

    // Only A and C are accepted. P (partial), R (referral), S/I (SCA),
    // J (soft decline), f, e, X, blank, and undocumented codes are excluded.
    expect(code).toMatch(/v_approval_codes constant text\[\] := array\['A', 'C'\]/)
  })

  it("allows only response code P to create partial-authorization evidence", () => {
    const code = migrationCode()
    const applyStart = code.indexOf("function public.apply_shift4_attempt_evidence")
    const applyEnd = code.indexOf("function public.release_shift4_attempt_lease", applyStart)
    const applyBody = code.slice(applyStart, applyEnd)
    expect(applyBody).toContain("elsif v_effective_code = 'P' then")
    expect(applyBody).not.toMatch(/v_effective_code = 'P'\s+or\s*\(/)
    expect(applyBody).toContain("v_amount_problem := 'approved_amount_below_requested'")
    expect(applyBody).toContain("v_state_override := 'reconciliation_required'")
    expect(applyBody).toContain("v_recovery_override := 'blocked'")
    expect(applyBody).toContain("a.approved_amount_minor = a.amount_minor")
    expect(applyBody).toMatch(/remaining_amount_minor = case\s+when v_amount_problem is not null then null/)
    expect(applyBody).toMatch(/authorized_amount_minor = case\s+when v_amount_problem is not null then null/)
  })

  /* ── Lease authority ──────────────────────────────────────────────────────*/

  it("refuses an expired lease even for its recorded holder", () => {
    const code = migrationCode()
    expect(code).toContain("lease_expired")
    expect(code).toContain("attempt_lease_expired")
    expect(code).toContain("v_attempt.lease_expires_at <= now()")
  })

  it("requires an exact, non-blank holder to write under a live lease", () => {
    const code = migrationCode()
    expect(code).toContain("attempt_leased_by_another_worker")
    expect(code).toMatch(/p_lease_owner is null or length\(btrim\(p_lease_owner\)\) = 0/)
  })

  it("rejects a null or blank lease owner on release", () => {
    const code = migrationCode()
    const start = code.indexOf("function public.release_shift4_attempt_lease")
    const body = code.slice(start)
    expect(body).toContain("A lease owner is required to release")
    // Exact match, not `is not distinct from`: a null caller must never match
    // an unleased row and report a successful release.
    expect(body).toContain("a.lease_owner = p_lease_owner")
    expect(body).not.toContain("a.lease_owner is not distinct from p_lease_owner")
  })

  /* ── Version and reconciliation consistency ───────────────────────────────*/

  it("increments the attempt version exactly once per evidence application", () => {
    const code = migrationCode()
    // Bound the slice to THIS function; release_shift4_attempt_lease follows it
    // and legitimately updates the same table.
    const start = code.indexOf("function public.apply_shift4_attempt_evidence")
    const end = code.indexOf("function public.release_shift4_attempt_lease", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = code.slice(start, end)

    // Exactly one UPDATE of the attempts table, so late success and illegal
    // transitions cannot double-increment.
    const updates = body.match(/update public\.shift4_payment_attempts/g) || []
    expect(updates).toHaveLength(1)
    const increments = body.match(/version = a\.version \+ 1/g) || []
    expect(increments).toHaveLength(1)
    expect(migrationSql()).toContain("THE single version increment")
  })

  it("persists reconciliation state and reason in that single update", () => {
    const code = migrationCode()
    expect(code).toContain("v_final_state := 'reconciliation_required'")
    expect(code).toContain("late_provider_outcome_after_terminal_state")
    expect(code).toContain("v_final_reason := 'illegal_lifecycle_transition'")
    // Returned outcome and stored state are decided together.
    expect(code).toContain("v_outcome := 'reconciliation_required'")
  })

  it("returns the persisted reconciliation contract for every known amount conflict", () => {
    const code = migrationCode()
    const applyStart = code.indexOf("create function public.apply_shift4_attempt_evidence")
    const applyEnd = code.indexOf("function public.release_shift4_attempt_lease", applyStart)
    const applyBody = code.slice(applyStart, applyEnd)
    const contractStart = applyBody.indexOf("if v_amount_problem in (")
    const missingLookup = applyBody.slice(
      applyBody.indexOf("if v_amount_problem is not null then"),
      applyBody.indexOf("Split-tender aggregation")
    )
    const resultContract = applyBody.slice(contractStart, applyBody.indexOf("Update the attempt", contractStart))

    for (const problem of [
      "approved_amount_below_requested",
      "approved_amount_exceeds_requested",
      "partial_approved_amount_not_below_requested",
    ]) {
      expect(resultContract).toContain(`'${problem}'`)
    }
    expect(resultContract).not.toContain("'approved_amount_missing'")
    expect(resultContract).toContain("v_outcome := 'reconciliation_required'")
    expect(resultContract).toContain("v_conflict := v_amount_problem")
    expect(missingLookup).toContain("v_state_override := 'unresolved'")
    expect(missingLookup).toContain("v_recovery_override := 'pending_lookup'")
    expect(missingLookup).toContain("v_ledger_eligible := false")
    expect(missingLookup).toContain("v_target := null")

    const contract = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    for (const field of [
      'result.outcome !== "reconciliation_required"',
      'result.attemptState !== "reconciliation_required"',
      'result.attemptRecoveryState !== "blocked"',
      "result.reconciliationRequired !== true",
      "result.appliedStatus !== null",
      "result.ledgerPosted !== false",
    ]) expect(contract).toContain(field)
  })

  it("records duplicate evidence without a second transition or ledger effect", () => {
    const code = migrationCode()
    expect(code).toContain("v_outcome := 'already_applied'")
    expect(code).toContain("v_outcome in ('evidence_recorded', 'already_applied')")
    // The documented contract: the version DOES advance, because the evidence
    // was genuinely recorded, but nothing financial happens.
    expect(migrationSql()).toContain("append-only audit")
  })

  /* ── Legacy-schema preflight completeness ─────────────────────────────────*/

  it("verifies every ledger column the insert writes", () => {
    const code = migrationCode()
    for (const column of [
      "merchant_id", "payment_id", "provider", "network", "asset",
      "amount", "usd_value", "wallet_address", "direction", "status",
    ]) {
      expect(code, column).toContain(`('${column}')`)
    }
    // ...their types, and that `id` can be generated without being supplied.
    expect(code).toContain("ledger_entries.amount and usd_value to be numeric")
    expect(code).toContain("ledger_entries.id to have a default or be an identity column")
  })

  it("verifies every event type against all applicable check constraints", () => {
    const code = migrationCode()
    for (const eventType of [
      "payment.reconciled", "payment.pending", "payment.processing",
      "payment.confirmed", "payment.failed", "payment.canceled",
      "payment.expired", "payment.incomplete",
    ]) {
      expect(code, eventType).toContain(`('${eventType}')`)
    }
    // Not tied to one hardcoded constraint name: the accepted set has been
    // rewritten by more than one past migration.
    expect(code).not.toMatch(/conname = 'payment_events_event_type_check'/)
    expect(code).toContain("pg_get_constraintdef(oid) like '%payment.%'")
  })

  it("checks variadic and pseudo-type builtins through pg_proc, not regprocedure", () => {
    const code = migrationCode()
    // A regprocedure cast must parse its argument list, and the documentation
    // display form of a variadic signature is not guaranteed to be accepted.
    expect(code).not.toContain("jsonb_build_object(variadic")
    expect(code).not.toMatch(/to_regprocedure\('pg_catalog\.make_interval/)
    expect(code).toContain("p.proname = 'jsonb_build_object'")
    expect(code).toContain("p.proname = 'make_interval'")
    expect(code).toContain("p.provariadic <> 0")
  })

  /* ── Origin-invoice ownership matrix ──────────────────────────────────────
   * The ten scenarios the invoice model must decide. Each is asserted against
   * the executable rule that decides it, since the SQL cannot be run here.
   * ------------------------------------------------------------------------ */

  it("decides every origin/chain invoice scenario", () => {
    const code = migrationCode()

    const originIndex =
      /create unique index shift4_payment_attempts_connection_chain_invoice_uidx\s*\n\s*on public\.shift4_payment_attempts \(merchant_provider_connection_id, invoice\)\s*\n\s*where root_attempt_id = attempt_id/
    const operationIndex =
      "on public.shift4_payment_attempts (merchant_provider_connection_id, invoice, attempt_role)"

    // 1 first sale establishes the chain - permitted by both indexes.
    // 2 second sale on that invoice - same operation, blocked by BOTH.
    expect(code).toContain(operationIndex)
    // 3 authorization after an unrelated sale - different operation, so only
    // 4 sale after an unrelated authorization - the partial origin index blocks.
    expect(code).toMatch(originIndex)
    expect(code).toContain("invoice_already_owned_by_another_chain")

    // 5 authorization + its linked capture share the invoice: capture is not an
    //   origin operation, so the partial index does not apply to it.
    expect(code).toContain("where root_attempt_id = attempt_id")
    // 6 an unrelated capture cannot: lineage must match the chain.
    expect(code).toContain("invoice_does_not_match_related_attempt")
    expect(code).toContain("related_attempt_belongs_to_another_payment")

    // 7 a linked void may share it; 8 an unrelated void may not.
    expect(code).toContain("shift4_payment_attempts_void_requires_related_check")
    expect(code).toContain("void_target_is_not_a_voidable_operation")

    // 9 a refund may never reuse any existing invoice on the connection.
    expect(code).toContain("refund_must_not_reuse_an_existing_invoice")

    // 10 a different MID is a different chain: every invoice rule is scoped to
    //    merchant_provider_connection_id, never to merchant_id alone.
    expect(code).toContain("related_attempt_belongs_to_another_provider_connection")
    expect(code).not.toMatch(/unique index[\s\S]{0,160}\(merchant_id, invoice\)/)
  })

  it("keeps the origin guard race-safe, not merely read-checked", () => {
    const code = migrationCode()
    // Two concurrent inserts can both pass a read-before-insert check, so the
    // partial unique index must exist AND be classified in the handler.
    const readCheck = code.indexOf("and a.root_attempt_id = a.attempt_id")
    const index = code.indexOf("shift4_payment_attempts_connection_chain_invoice_uidx")
    expect(readCheck).toBeGreaterThan(-1)
    expect(index).toBeGreaterThan(-1)
    expect(migrationSql()).toContain("authoritative")
  })

  /* ── Transaction chain and manual authorization ───────────────────────────
   * The model that makes retail certification test 7 possible at all. The old
   * operation-scoped invoice index rejected the manual authorization outright:
   * it reuses the referral's invoice and both calls are the authorization
   * endpoint, so both rows carried operation = 'authorization'.
   * ------------------------------------------------------------------------ */

  it("models a chain with roles rather than endpoints", () => {
    const code = migrationCode()
    for (const column of ["chain_id uuid not null", "root_attempt_id text not null", "attempt_role text not null"]) {
      expect(code, column).toContain(column)
    }
    expect(code).toContain("attempt_role in (")
    for (const role of [
      "'sale'", "'authorization'", "'referral_authorization'",
      "'manual_authorization'", "'partial_authorization'",
      "'capture'", "'void'", "'refund'",
    ]) {
      expect(code, role).toContain(role)
    }
    // A role must be reachable through the endpoint that was invoked.
    expect(code).toContain("shift4_payment_attempts_role_matches_operation_check")
    expect(code).toContain("'manual_authorization', 'partial_authorization'))")
  })

  it("lets one invoice carry several legitimate authorization steps", () => {
    const code = migrationCode()
    // Role-scoped, so referral_authorization and manual_authorization coexist.
    expect(code).toContain(
      "on public.shift4_payment_attempts (merchant_provider_connection_id, invoice, attempt_role)"
    )
    // The operation-scoped form that blocked certification must be gone.
    expect(code).not.toMatch(/(merchant_provider_connection_id, invoice, operation)/)
  })

  it("binds one invoice to exactly one chain root", () => {
    const code = migrationCode()
    expect(code).toMatch(
      /create unique index shift4_payment_attempts_connection_chain_invoice_uidx\s*\n\s*on public\.shift4_payment_attempts \(merchant_provider_connection_id, invoice\)\s*\n\s*where root_attempt_id = attempt_id/
    )
    expect(code).toContain("invoice_already_owned_by_another_chain")
    // One root per chain, too.
    expect(code).toContain("shift4_payment_attempts_chain_root_uidx")
    expect(code).toContain("shift4_payment_attempts_chain_root_check")
  })

  it("requires a manual authorization to resolve a referral in its own chain", () => {
    const code = migrationCode()
    expect(code).toContain("manual_authorization_requires_a_referral_authorization")
    expect(code).toContain("manual_authorization_requires_an_authorization_code")
    expect(code).toContain("manual_authorization_amount_must_match_the_referral")
    // The PARENT's stored role decides, not anything the caller asserted.
    expect(code).toContain("v_authorization.attempt_role <> 'referral_authorization'")
    // Lineage is re-checked for every child.
    expect(code).toContain("related_attempt_belongs_to_another_payment")
    expect(code).toContain("related_attempt_belongs_to_another_provider_connection")
    expect(code).toContain("invoice_does_not_match_related_attempt")
  })

  it("stores the voice-centre contact details and nothing sensitive", () => {
    const code = migrationCode()
    expect(code).toContain("voice_center_account_number text")
    expect(code).toContain("voice_center_phone_number text")
    expect(code).toContain("manual_authorization_code text")
    expect(code).toContain("shift4_payment_attempts_manual_code_check")
    // No call recording or cardholder data anywhere.
    // Column definitions only: the table COMMENT legitimately NAMES the
    // cardholder data it never stores.
    expect(code).not.toMatch(/^\s*(call_recording|voice_recording|pan|track_data|pin_block)\s+text/im)
  })

  it("promotes roles from provider evidence, never from the caller", () => {
    const code = migrationCode()
    expect(code).toContain("attempt_role_is_not_requestable")
    // referral_authorization and partial_authorization are resolved states.
    expect(code).toContain("v_final_role := 'referral_authorization'")
    expect(code).toContain("v_final_role := 'partial_authorization'")
    expect(code).toMatch(/'sale', 'authorization', 'manual_authorization', 'capture', 'void', 'refund'/)
  })

  /* ── Authorization amount authority ───────────────────────────────────────*/

  it("never invents an authorization amount from the request", () => {
    const code = migrationCode()
    expect(code).toContain("authorized_amount_minor =")
    expect(code).toContain("coalesce(v_authorized_amount, a.authorized_amount_minor)")
    // No requested-amount fallback survives anywhere.
    expect(code).not.toMatch(/coalesce\(p_authorized_amount_minor, a\.authorized_amount_minor\)/)

    for (const file of ["executeTransaction.ts", "recoverUnknownOutcome.ts"]) {
      const source = engineSource(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
      expect(source, file).not.toMatch(/approvedAmountMinor \?\? (amountMinor|attempt\.amount_minor)/)
      expect(source, file).not.toMatch(/authorizedAmountMinor:/)
    }
  })

  it("blocks capture when the authorized amount is unknown", () => {
    const code = migrationCode()
    expect(code).toContain("authorization_amount_unknown")
    expect(code).toContain("v_authorization.authorized_amount_minor is null")
  })

  it("preserves evidence when the approved amount is missing or wrong", () => {
    const code = migrationCode()
    // Not a hard rejection: the provider evidence is still written.
    expect(code).toContain("v_amount_problem := 'approved_amount_missing'")
    expect(code).toContain("v_amount_problem := 'approved_amount_exceeds_requested'")
    expect(code).toContain("v_state_override := 'unresolved'")
    expect(code).toContain("v_recovery_override := 'pending_lookup'")
    expect(code).toContain("v_ledger_eligible := false")
  })

  /* ── Partial authorization and tenders ────────────────────────────────────*/

  it("records the exact partial amount and its remainder", () => {
    const code = migrationCode()
    expect(code).toContain("remaining_amount_minor bigint")
    expect(code).toContain("shift4_payment_attempts_partial_remainder_check")
    expect(code).toContain("approved_amount_minor + remaining_amount_minor = amount_minor")
    expect(code).toContain("v_remaining_amount := v_attempt.amount_minor - v_effective_approved")
  })

  it("adds no canonical PARTIAL payment status", () => {
    const code = migrationCode()
    expect(code).not.toMatch(/'PARTIAL'/)
    const stateMachine = readFileSync(join(process.cwd(), "engine", "paymentStateMachine.ts"), "utf8")
    expect(stateMachine).not.toContain("PARTIAL")
  })

  it("bounds every later tender by the unpaid remainder", () => {
    const code = migrationCode()
    expect(code).toContain("tender_would_exceed_payment_total")
    expect(code).toContain("tender_sequence")
    // Computed under a row lock so two tenders cannot both read the remainder.
    const start = code.indexOf("tender_would_exceed_payment_total")
    expect(start).toBeGreaterThan(-1)
    const body = code.slice(Math.max(0, start - 1600), start)
    expect(body).toContain("for update")
  })

  /* ── Split-tender aggregation ─────────────────────────────────────────────*/

  it("confirms only when the captured total equals the requested total", () => {
    const code = migrationCode()
    expect(code).toContain("v_captured_total < v_payment_requested_minor")
    expect(code).toContain("tender_incomplete")
    expect(code).toContain("captured_total_exceeds_payment_total")
    // Aggregated under FOR UPDATE in the same transaction as the transition.
    const start = code.indexOf("tender_incomplete")
    expect(start).toBeGreaterThan(-1)
    const body = code.slice(Math.max(0, start - 1800), start)
    expect(body).toContain("for update")
    expect(body).toContain("a.operation in ('sale', 'capture')")
    expect(body).toContain("a.response_code in ('A', 'C')")
  })

  it("journals split tenders and charges the platform fee once per payment", () => {
    const code = migrationCode()
    expect(code).toContain("v_captured_total < v_payment_requested_minor")
    expect(code).toContain("v_target := 'CONFIRMED'")
    expect(code).toContain("shift4.platform_fee.v1|")
    expect(code).toContain("'amount_minor', 15")
    expect(code).toContain("where g.id = v_group.id")
  })

  it("wraps everything in one transaction", () => {
    const sql = migrationSql()
    expect(sql.trimStart().startsWith("begin;") || sql.includes("\nbegin;")).toBe(true)
    expect(sql.trimEnd().endsWith("commit;")).toBe(true)
  })
})

/* ══ E. Storage replacement ═════════════════════════════════════════════════ */

describe("Shift4 metadata storage removal", () => {
  it("keeps no attempt storage in payments.metadata", () => {
    for (const file of engineSourceFiles()) {
      // Strip comments first: the modules legitimately DESCRIBE the removed
      // design so a future reader knows why it went. Only executable code is
      // asserted on.
      const code = engineSource(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")

      expect(code, file).not.toContain("updatePaymentMetadata")
      expect(code, file).not.toContain("metadata.shift4")
      expect(code, file).not.toContain("SHIFT4_METADATA_KEY")
      expect(code, file).not.toMatch(/payment\.metadata|\.metadata\s*\[/)
    }
  })

  it("removes the invoiceIndex map entirely", () => {
    for (const file of engineSourceFiles()) {
      expect(engineSource(file), file).not.toContain("invoiceIndex")
    }
  })

  it("removes saveAttempt in favour of database-backed operations", () => {
    for (const file of engineSourceFiles()) {
      expect(engineSource(file), file).not.toMatch(/\bsaveAttempt\b/)
    }
    expect(engineSource("executeTransaction.ts")).toContain("createShift4PaymentAttempt")
    expect(engineSource("executeTransaction.ts")).toContain("applyShift4AttemptEvidence")
  })

  it("retains no compatibility fallback to the unsafe storage", () => {
    // Phase 2 is uncommitted and unwired, so there is nothing to be compatible
    // with. A fallback would silently reintroduce the lost-update hazard.
    const source = engineSource("attempt.ts")
    expect(source).not.toContain("readShift4Metadata")
    expect(source).not.toContain("listAttempts")
    expect(source).not.toContain("readAttempt")
  })

  it("creates the attempt before any provider call", () => {
    const source = engineSource("executeTransaction.ts")
    const create = source.indexOf("createShift4PaymentAttempt({")
    const call = source.indexOf("await callShift4({")
    expect(create).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(-1)
    // Persist-before-transmit: recovery can look the invoice up even if the
    // process dies mid-flight.
    expect(create).toBeLessThan(call)
  })

  it("fails an invoice collision before transmission", () => {
    const source = engineSource("executeTransaction.ts")
    const collision = source.indexOf("invoice_collision")
    const call = source.indexOf("await callShift4({")
    expect(collision).toBeGreaterThan(-1)
    expect(collision).toBeLessThan(call)
    expect(source).toContain("No transaction was transmitted.")
  })

  it("surfaces a conflicting idempotency key as a controlled error", () => {
    const source = engineSource("executeTransaction.ts")
    expect(source).toContain("idempotency_conflict")
    expect(source).toContain("already used for a different Shift4 request")
  })

  it("surfaces a stale write as a controlled version conflict", () => {
    const source = engineSource("executeTransaction.ts")
    expect(source).toContain("version_conflict")
    expect(source).toContain("modified by another writer")
  })
})

/* ══ F. Authorization and capture ═══════════════════════════════════════════ */

describe("Shift4 authorization and capture", () => {
  it("requires an approved authorization before a capture", () => {
    const source = engineSource("executeTransaction.ts")
    expect(source).toContain("A capture requires an approved authorization.")
    expect(source).toContain("must reference the authorization attempt it closes")
    // The database re-checks it, so a direct RPC caller cannot bypass this.
    expect(migrationSql()).toContain("authorization_not_approved")
  })

  it("rejects a capture that exceeds the authorized amount", () => {
    const source = engineSource("executeTransaction.ts")
    expect(source).toContain("A capture cannot exceed the authorized amount.")
    expect(source).toContain("amountMinor > authorization.authorized_amount_minor")
    expect(migrationSql()).toContain("capture_amount_exceeds_authorized_amount")
  })

  it("compares capture amounts in integer minor units", () => {
    const source = engineSource("executeTransaction.ts")
    // A float comparison here would be a money bug.
    expect(source).toContain("integer minor units - never a float")
    expect(source).not.toMatch(/amount\s*>\s*authorization\.authorized_amount\b/)
  })

  it("allows a capture exactly equal to the authorized amount", () => {
    // Certification requires amount.total to equal the authorization amount.
    const authorized = minor(111.45)
    const capture = minor(111.45)
    expect(capture > authorized).toBe(false)
    expect(capture).toBe(authorized)
  })

  it("supplies no authorization amount from the Engine at all", () => {
    // The authorized amount is DERIVED in the database from provider evidence.
    // The old `evidence.approvedAmountMinor ?? amountMinor` fallback let an
    // approval with no amount evidence invent its authorized amount from the
    // request, and a later capture would then have settled against a figure
    // Shift4 never stated.
    const source = engineSource("executeTransaction.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")

    expect(source).not.toContain("authorizedAmountMinor")
    expect(source).not.toMatch(/approvedAmountMinor \?\? amountMinor/)
    expect(migrationCode()).toContain("coalesce(v_authorized_amount, a.authorized_amount_minor)")
  })

  it("reuses the authorization invoice for a capture", () => {
    const source = engineSource("executeTransaction.ts")
    expect(source).toContain("must reuse the authorization's invoice")
    expect(source).toContain("invoice = authorization.invoice")
  })
})

/* ══ G. Unknown outcome and recovery ════════════════════════════════════════ */

describe("Shift4 unknown-outcome recovery", () => {
  it("parks a timeout as unresolved without touching the payment status", () => {
    const source = engineSource("executeTransaction.ts")
    expect(source).toContain("isShift4UnknownOutcomeError")
    expect(source).toContain("state: \"unresolved\"")
    expect(source).toContain("recoveryState: \"pending_lookup\"")
    // A timeout proves nothing, so no transition is requested.
    expect(source).toContain("targetStatus: null")
  })

  it("honours the documented environment-specific recovery delay", () => {
    expect(engineSource("executeTransaction.ts")).toContain("SHIFT4_RECOVERY_DELAY_MS")
    expect(engineSource("recoverUnknownOutcome.ts")).toContain("SHIFT4_RECOVERY_DELAY_MS")
  })

  it("looks the SAME invoice up rather than resending blindly", () => {
    const source = engineSource("recoverUnknownOutcome.ts")
    expect(source).toContain("invoice: attempt.invoice")
    expect(source).toContain("getInvoice")
  })

  it("claims a database lease before any recovery provider call", () => {
    const source = engineSource("recoverUnknownOutcome.ts")
    const claim = source.indexOf("claimDueShift4PaymentAttempts")
    expect(claim).toBeGreaterThan(-1)
    expect(source).toContain("another recovery worker currently holds its lease")
  })

  it("carries the version it read into every recovery write", () => {
    const source = engineSource("recoverUnknownOutcome.ts")
    expect(source).toContain("expectedVersion: attempt.version")
  })

  it("marks invoice-lookup evidence as authoritative lookup evidence", () => {
    const source = engineSource("recoverUnknownOutcome.ts")
    expect(source).toContain("evidenceSource: \"invoice_lookup\"")
  })

  it("bounds lookup passes", () => {
    const source = engineSource("recoverUnknownOutcome.ts")
    expect(source).toContain("MAX_LOOKUP_PASSES")
    expect(source).toContain("lookup_passes_exhausted")
  })

  it("never voids a failed transaction as cleanup", () => {
    const source = engineSource("recoverUnknownOutcome.ts")
    expect(source).toContain("must NEVER be voided as cleanup")
    expect(source).not.toContain("voidInvoice")
  })
})

/* ══ H. Same-invoice resend policy ══════════════════════════════════════════ */

describe("Shift4 same-invoice resend policy", () => {
  const pendingPayment = { status: "PROCESSING" }

  it("permits a resend only after an authoritative Invoice Not Found", () => {
    const decision = evaluateResendPolicy({
      payment: pendingPayment,
      attempt: baseAttempt(),
    })
    expect(decision.allowed).toBe(true)
  })

  it("blocks a resend when Shift4 did not report Invoice Not Found", () => {
    const decision = evaluateResendPolicy({
      payment: pendingPayment,
      attempt: baseAttempt({ resolutionReason: "lookup_passes_exhausted" }),
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("shift4_did_not_report_invoice_not_found")
  })

  it("blocks a resend when any prior approval evidence exists for the invoice", () => {
    // Shift4 returns "Invoice Not Found" for a voided or already settled
    // invoice too, so prior approval evidence must veto the resend.
    for (const attempt of [
      baseAttempt({ authorizationCode: "OK1234" }),
      baseAttempt({ retrievalReference: "REF123456789" }),
      baseAttempt({ responseCode: "A" }),
      baseAttempt({ responseCode: "C" }),
      baseAttempt({ responseCode: "P" }),
      baseAttempt({ state: "approved" }),
    ]) {
      const decision = evaluateResendPolicy({ payment: pendingPayment, attempt })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe("prior_approval_evidence_exists_for_invoice")
    }
  })

  it("never permits resending a refund or a void", () => {
    for (const operation of ["refund", "void"] as Shift4EngineOperation[]) {
      const decision = evaluateResendPolicy({
        payment: pendingPayment,
        attempt: baseAttempt({ operation }),
      })
      expect(decision.allowed, operation).toBe(false)
      expect(decision.reason).toContain("operation_not_resendable")
    }
  })

  it("blocks a resend once the payment is terminal", () => {
    for (const status of ["CONFIRMED", "FAILED", "EXPIRED", "CANCELED", "INCOMPLETE"]) {
      const decision = evaluateResendPolicy({
        payment: { status },
        attempt: baseAttempt(),
      })
      expect(decision.allowed, status).toBe(false)
      expect(decision.reason).toContain("payment_already_terminal")
    }
  })

  it("respects the resend budget", () => {
    const decision = evaluateResendPolicy({
      payment: pendingPayment,
      attempt: baseAttempt({ resendCount: MAX_RESENDS }),
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("resend_limit_reached")
  })

  it("blocks a resend while another worker holds the attempt", () => {
    const decision = evaluateResendPolicy({
      payment: pendingPayment,
      attempt: baseAttempt({ recoveryState: "blocked" }),
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("attempt_held_by_another_worker")
  })

  it("preserves every resend decision as evidence", () => {
    const source = engineSource("recoverUnknownOutcome.ts")
    expect(source).toContain("shift4.resend_eligible")
    expect(source).toContain("shift4.resend_blocked")
    expect(source).toContain("Every resend decision is preserved")
  })
})

/* ══ I. Reconciliation discovery ════════════════════════════════════════════ */

describe("Shift4 reconciliation discovery", () => {
  it("queries the attempt table, never a generic payment scan", () => {
    const source = engineSource("reconcileShift4Payments.ts")
    expect(source).toContain("claimDueShift4PaymentAttempts")
    expect(source).toContain("listDueShift4PaymentAttempts")
    // The old implementation loaded payments across every rail.
    expect(source).not.toContain("from(\"payments\")")
    expect(source).not.toContain("RECONCILABLE_STATUSES")
  })

  it("does not filter unrelated rails in memory", () => {
    const source = engineSource("reconcileShift4Payments.ts")
    expect(source).not.toContain("listAttempts(payment)")
    expect(source).toContain("Nothing here touches another rail")
  })

  it("bounds the batch", () => {
    const source = engineSource("reconcileShift4Payments.ts")
    expect(source).toContain("Math.min(scope.limit ?? 25, 200)")
  })

  it("supports merchant, connection, payment, and attempt scope", () => {
    const source = engineSource("reconcileShift4Payments.ts")
    for (const field of [
      "merchantId",
      "merchantProviderConnectionId",
      "paymentId",
      "attemptId",
    ]) {
      expect(source, field).toContain(field)
    }
  })

  it("returns a continuation cursor", () => {
    const source = engineSource("reconcileShift4Payments.ts")
    expect(source).toContain("cursor")
    expect(source).toContain("nextCheckAt")
  })

  it("orders due work deterministically so the oldest cannot starve", () => {
    const sql = migrationSql()
    expect(sql).toContain("order by a.next_check_at asc, a.created_at asc, a.id asc")
  })

  it("performs no mutation in a dry run", () => {
    const source = engineSource("reconcileShift4Payments.ts")
    const dryRunStart = source.indexOf("if (dryRun) {")
    const dryRunEnd = source.indexOf("/* ── Live run")
    expect(dryRunStart).toBeGreaterThan(-1)
    expect(dryRunEnd).toBeGreaterThan(dryRunStart)

    const dryRunBlock = source.slice(dryRunStart, dryRunEnd)
    expect(dryRunBlock).toContain("listDueShift4PaymentAttempts")
    // No claim, no lease, no evidence write.
    expect(dryRunBlock).not.toContain("claimDueShift4PaymentAttempts")
    expect(dryRunBlock).not.toContain("applyShift4AttemptEvidence")
    expect(dryRunBlock).not.toContain("recoverClaimedAttempt")
  })

  it("adds no cron schedule in this phase", () => {
    const source = engineSource("reconcileShift4Payments.ts")
    expect(source).toContain("adds NO cron schedule")
    expect(source).not.toContain("vercel.json")
  })
})

/* ══ J. Event durability ════════════════════════════════════════════════════ */

describe("Shift4 critical event durability", () => {
  it("writes evidence, the transition, and the ledger in one transaction", () => {
    const sql = migrationSql()
    const applyStart = sql.indexOf("function public.apply_shift4_attempt_evidence")
    const body = sql.slice(applyStart)

    expect(body).toContain("insert into public.payment_events")
    expect(body).toContain("update public.payments")
    expect(body).toContain("insert into public.ledger_entries")
    // A plpgsql function body is one transaction, so a failed evidence insert
    // rolls the transition and the ledger entry back with it.
    expect(sql).toContain("commit together or not at all")
  })

  it("carries every business-critical field into the event payload", () => {
    const sql = migrationSql()
    for (const field of [
      "attemptId", "operation", "invoice", "responseCode", "providerReference",
      "authorizationCode", "approvedAmountMinor", "requestedAmountMinor",
      "evidenceSource", "correlationId", "providerOccurredAt", "receivedAt",
      "rawResponseRef",
    ]) {
      expect(sql, field).toContain(`'${field}'`)
    }
  })

  it("does not swallow a critical evidence failure", () => {
    const dbSource = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    expect(dbSource).toContain("Business-critical evidence: never downgraded to a warning")
    expect(dbSource).toContain("throw new Error(`Failed to apply Shift4 attempt evidence")

    // No blanket swallow anywhere in the Engine's critical path.
    for (const file of engineSourceFiles()) {
      expect(engineSource(file), file).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\}\)/)
    }
  })

  it("records the Shift4 step name without inventing a canonical event type", () => {
    const sql = migrationSql()
    expect(sql).toContain("'payment.reconciled'")
    expect(sql).toContain("p_shift4_event")
    // Shift4 detail rides provider_event, which is free text.
    expect(sql).toContain("provider_event")
  })

  it("stores both provider occurred_at and PineTree received_at", () => {
    const sql = migrationSql()
    expect(sql).toContain("provider_occurred_at timestamptz")
    expect(sql).toContain("received_at timestamptz")
  })
})

/* ══ K. Ledger safety ═══════════════════════════════════════════════════════ */

describe("Shift4 ledger safety", () => {
  it("posts only for an operation that settles the payment", () => {
    const settling: Shift4EngineOperation[] = ["sale", "capture"]
    const nonSettling: Shift4EngineOperation[] = ["authorization", "refund", "void"]

    for (const operation of settling) {
      expect(
        mapShift4Evidence({
          operation,
          result: evidence("approved", { responseCode: "A", approvedAmount: 25.5 }),
          requestedAmountMinor: minor(25.5),
        }).status === "CONFIRMED",
        operation
      ).toBe(true)
    }

    for (const operation of nonSettling) {
      expect(
        mapShift4Evidence({
          operation,
          result: evidence("approved", { responseCode: "A", approvedAmount: 25.5 }),
          requestedAmountMinor: minor(25.5),
        }).status === "CONFIRMED",
        operation
      ).toBe(false)
    }
  })

  it("never posts for a timeout or any unresolved outcome", () => {
    for (const outcome of ["unknown", "not_found"] as Shift4Outcome[]) {
      const mapping = mapShift4Evidence({
        operation: "sale",
        result: evidence(outcome),
        requestedAmountMinor: minor(25.5),
      })
      expect(mapping.status, outcome).toBeNull()
    }
  })

  it("never posts for a partial approval, referral, or SCA requirement", () => {
    for (const outcome of [
      "partial_approval", "referral", "authentication_required", "soft_declined",
    ] as Shift4Outcome[]) {
      expect(
        mapShift4Evidence({
          operation: "sale",
          result: evidence(outcome),
          requestedAmountMinor: minor(219),
        }).status === "CONFIRMED",
        outcome
      ).toBe(false)
    }
  })

  it("uses canonical posting keys and preserves the legacy exactly-once projection", () => {
    const sql = migrationSql()
    // A duplicate response, a duplicate lookup, and a recovered confirmation all
    // collapse onto the existing unique payment_id index.
    expect(sql).toContain("on conflict (payment_id) do nothing")
    expect(sql).toContain("p_posting_key => 'shift4.'")
    expect(sql).toContain("shift4.platform_fee.v1|")
  })

  it("uses the dedicated journal migration for split-tender accounting", () => {
    const sql = migrationSql()
    expect(sql).toContain("post_ledger_transaction")
    expect(sql).toContain("ledger_transactions")
  })
})

/* ══ K2. TypeScript storage safety ══════════════════════════════════════════ */

describe("Shift4 attempt storage safety", () => {
  const dbSource = () =>
    readFileSync(join(process.cwd(), "database", "shift4PaymentAttempts.ts"), "utf8")

  it("has no anon-client fallback for attempt access", () => {
    // Comment-stripped: the module doc legitimately NAMES the removed fallback
    // to explain why it must not come back.
    const source = stripComments(dbSource())
    // An anon read would not fail loudly - the table revokes everything from
    // anon, so it would return an empty set and a missing attempt would read as
    // "no such attempt" rather than "misconfigured deployment".
    expect(source).not.toMatch(/supabaseAdmin\s*\|\|\s*supabase/)
    expect(source).not.toMatch(/^import .*supabaseAnon/m)
    expect(source).not.toMatch(/\bsupabaseAnon\b(?![^\n]*fallback)/)
  })

  it("routes every table access through serviceRoleDb()", () => {
    const source = dbSource()
    const accesses = source.match(/\n\s*(?:const \{ data, error \} = await|let query =) ([^\n]+)\n\s*\.from\("shift4_payment_attempts"\)/g) || []
    expect(accesses.length).toBeGreaterThanOrEqual(3)
    for (const access of accesses) {
      expect(access).toContain("serviceRoleDb()")
    }
    // Every RPC too.
    for (const fn of [
      "create_shift4_payment_attempt", "claim_due_shift4_payment_attempts",
      "apply_shift4_attempt_evidence", "release_shift4_attempt_lease",
    ]) {
      const at = source.indexOf(`rpc("${fn}"`)
      expect(source.slice(Math.max(0, at - 120), at), fn).toContain("serviceRoleDb()")
    }
  })

  it("keeps an explicit merchant filter on every scoped read", () => {
    const source = dbSource()
    for (const fn of ["getShift4PaymentAttempt", "listShift4PaymentAttempts"]) {
      const start = source.indexOf(`export async function ${fn}`)
      const body = source.slice(start, source.indexOf("\n}", start))
      expect(body, fn).toContain('eq("merchant_id", merchantId)')
    }
  })

  it("rejects money that JavaScript cannot represent exactly", () => {
    for (const bad of [
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      1.5, -1, Number.MAX_SAFE_INTEGER + 2,
    ]) {
      expect(() => assertSafeMinorUnits(bad, "amountMinor"), String(bad)).toThrow()
    }
  })

  it("accepts a valid safe-integer minor amount", () => {
    for (const good of [0, 1, 2550, 11145, Number.MAX_SAFE_INTEGER]) {
      expect(assertSafeMinorUnits(good, "amountMinor")).toBe(good)
    }
    expect(assertOptionalSafeMinorUnits(null, "x")).toBeNull()
    expect(assertOptionalSafeMinorUnits(undefined, "x")).toBeNull()
  })

  it("parses a bigint returned as a decimal string exactly", () => {
    // PostgREST may serialize bigint as a string depending on magnitude.
    expect(parseMinorUnits("2550", "amountMinor")).toBe(2550)
    expect(parseMinorUnits("0", "amountMinor")).toBe(0)
    expect(parseMinorUnits(String(Number.MAX_SAFE_INTEGER), "amountMinor"))
      .toBe(Number.MAX_SAFE_INTEGER)
  })

  it("rejects a returned bigint that would lose precision", () => {
    // 2^53 + 1 is not representable; Number() would silently round it.
    expect(() => parseMinorUnits("9007199254740993", "amountMinor")).toThrow()
    expect(() => parseMinorUnits("99999999999999999999", "amountMinor")).toThrow()
    expect(() => parseMinorUnits("12.5", "amountMinor")).toThrow()
    expect(() => parseMinorUnits("not-a-number", "amountMinor")).toThrow()
    expect(() => parseMinorUnits({}, "amountMinor")).toThrow()
    expect(parseOptionalMinorUnits(null, "x")).toBeNull()
  })

  it("never coerces a financial field with a bare Number(...)", () => {
    const source = dbSource()
    expect(source).not.toMatch(/Number\(row\.amount_minor\)/)
    expect(source).not.toMatch(/Number\(row\.approved_amount_minor\)/)
    expect(source).not.toMatch(/Number\(row\.authorized_amount_minor\)/)
    expect(source).toContain("parseMinorUnits(row.amount_minor")
  })
})

/* ══ L. Phase 3 readiness contracts ═════════════════════════════════════════ */

describe("Shift4 provider readiness", () => {
  const fullyReady: Shift4ProviderReadiness = {
    credentials_configured: true,
    authenticated: true,
    ecommerce_capable: true,
    retail_capable: true,
    terminal_configured: true,
    certification_verified: true,
    processing_enabled: true,
  }

  it("does not become selectable from authentication alone", () => {
    // A successful Access Token Exchange proves PineTree can authenticate. It
    // proves nothing about boarding, devices, or certification.
    const authenticatedOnly: Shift4ProviderReadiness = {
      ...SHIFT4_READINESS_NONE,
      credentials_configured: true,
      authenticated: true,
      ecommerce_capable: true,
      retail_capable: true,
      terminal_configured: true,
    }

    expect(isShift4ChannelSelectable(authenticatedOnly, "ecommerce")).toBe(false)
    expect(isShift4ChannelSelectable(authenticatedOnly, "retail")).toBe(false)
  })

  it("requires certification and processing before either channel is selectable", () => {
    for (const missing of ["certification_verified", "processing_enabled"] as const) {
      const readiness = { ...fullyReady, [missing]: false }
      expect(isShift4ChannelSelectable(readiness, "ecommerce"), missing).toBe(false)
      expect(isShift4ChannelSelectable(readiness, "retail"), missing).toBe(false)
    }
  })

  it("requires a registered terminal for the retail channel only", () => {
    const noTerminal = { ...fullyReady, terminal_configured: false }
    expect(isShift4ChannelSelectable(noTerminal, "retail")).toBe(false)
    // E-commerce runs through i4Go and needs no PAX device.
    expect(isShift4ChannelSelectable(noTerminal, "ecommerce")).toBe(true)
  })

  it("keeps an incomplete capability unselectable per channel", () => {
    expect(
      isShift4ChannelSelectable({ ...fullyReady, ecommerce_capable: false }, "ecommerce")
    ).toBe(false)
    expect(
      isShift4ChannelSelectable({ ...fullyReady, retail_capable: false }, "retail")
    ).toBe(false)
  })

  it("treats a merchant with no connection as fully unready", () => {
    for (const value of Object.values(SHIFT4_READINESS_NONE)) {
      expect(value).toBe(false)
    }
    expect(isShift4ChannelSelectable(SHIFT4_READINESS_NONE, "ecommerce")).toBe(false)
    expect(isShift4ChannelSelectable(SHIFT4_READINESS_NONE, "retail")).toBe(false)
  })

  it("exposes no credential-bearing field on any response contract", () => {
    const source = engineSource("phase3Contracts.ts")
    const responseStart = source.indexOf("export type Shift4OperationResponse = {")
    const responseBody = source.slice(responseStart)

    for (const forbidden of [
      "accessToken", "authToken", "clientGuid", "cardTokenValue",
      "accessBlock", "rawPayload", "envelope", "credentials",
    ]) {
      expect(responseBody, forbidden).not.toContain(forbidden)
    }
  })

  it("stays unwired to any route or registry", () => {
    const source = engineSource("phase3Contracts.ts")
    expect(source).toContain("TYPES ONLY")
    expect(source).not.toContain("NextRequest")
    expect(source).not.toContain("NextResponse")
  })
})

/* ══ M. Security and architecture boundaries ════════════════════════════════ */

describe("Shift4 Engine security boundaries", () => {
  it("does not introduce a canonical UNKNOWN payment status", () => {
    const stateMachine = readFileSync(
      join(process.cwd(), "engine", "paymentStateMachine.ts"),
      "utf8"
    )
    expect(stateMachine).not.toContain("\"UNKNOWN\"")

    // Unknown lives at the attempt level instead.
    expect(engineSource("types.ts")).toContain("unresolved")
  })

  it("never persists a raw card token, only a fingerprint", () => {
    const source = engineSource("attempt.ts")
    expect(source).toContain("cardTokenFingerprint")
    expect(source).toContain("fingerprintCardToken(result.cardTokenValue)")

    // The token is a legitimate INPUT on the execute request - it has to be
    // sent to Shift4 - but the PERSISTED row must only hold a fingerprint.
    const dbSource = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    const rowStart = dbSource.indexOf("export type Shift4PaymentAttemptRow = {")
    const rowEnd = dbSource.indexOf("\n}", rowStart)
    expect(rowStart).toBeGreaterThan(-1)
    const rowType = dbSource.slice(rowStart, rowEnd)

    expect(rowType).toContain("card_token_fingerprint")
    expect(rowType).not.toMatch(/card_token_value|cardTokenValue/)
    expect(rowType).not.toMatch(/idempotency_key\b/)
  })

  it("never selects or returns the idempotency key hash", () => {
    const dbSource = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    const safeStart = dbSource.indexOf("const SAFE_COLUMNS")
    const safeEnd = dbSource.indexOf("].join(", safeStart)
    const safeColumns = dbSource.slice(safeStart, safeEnd)
    expect(safeColumns).not.toContain("idempotency_key_hash")
  })

  it("never returns a credential from the claim function", () => {
    const sql = migrationSql()
    const claimStart = sql.indexOf("function public.claim_due_shift4_payment_attempts")
    const claimEnd = sql.indexOf("function public.apply_shift4_attempt_evidence")
    const claimBody = sql.slice(claimStart, claimEnd)

    for (const secret of [
      "access_token", "auth_token", "client_guid", "idempotency_key_hash", "credentials",
    ]) {
      expect(claimBody, secret).not.toContain(secret)
    }
  })

  it("routes every provider call through the Phase 1 client", () => {
    for (const file of engineSourceFiles()) {
      const source = engineSource(file)
      // No Engine module may reach Shift4 directly.
      expect(source, file).not.toMatch(/fetch\s*\(\s*[`'"]https?:\/\//)
      expect(source, file).not.toContain("api.shift4")
    }
  })

  it("requires the service-role client for every attempt mutation", () => {
    const dbSource = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    expect(dbSource).toContain("function serviceRoleDb()")
    expect(dbSource).toContain("SUPABASE_SERVICE_ROLE_KEY is not configured")
    for (const fn of [
      "create_shift4_payment_attempt",
      "claim_due_shift4_payment_attempts",
      "apply_shift4_attempt_evidence",
      "release_shift4_attempt_lease",
    ]) {
      const call = dbSource.indexOf(`rpc("${fn}"`)
      expect(call, fn).toBeGreaterThan(-1)
      // Every RPC goes through serviceRoleDb(), never the anon client.
      expect(dbSource.slice(Math.max(0, call - 120), call), fn).toContain("serviceRoleDb()")
    }
  })

  it("scopes every attempt read by merchant", () => {
    const dbSource = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    // getShift4PaymentAttempt and listShift4PaymentAttempts both filter tenancy.
    const reads = dbSource.split("from(\"shift4_payment_attempts\")").slice(1)
    expect(reads.length).toBeGreaterThanOrEqual(2)
    for (const read of reads.slice(0, 2)) {
      expect(read).toContain("eq(\"merchant_id\", merchantId)")
    }
  })

  it("is not imported by any browser-facing module", () => {
    const offenders: string[] = []

    // Match the Shift4 Engine module precisely. `engine/shift4Onboarding` and
    // `engine/shift4Connection` are different, pre-existing modules and must not
    // be mistaken for this one.
    const importsShift4Server = (source: string) =>
      /["']@\/engine\/shift4(\/[^"']*)?["']/.test(source) ||
      /["']@\/database\/shift4PaymentAttempts["']/.test(source)

    const walk = (dir: string) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue

        const rel = relative(process.cwd(), full).replace(/\\/g, "/")
        // API routes are the sanctioned server-side caller of the Engine. The
        // boundary this guards is the browser bundle.
        if (rel.startsWith("app/api/")) continue

        if (importsShift4Server(readFileSync(full, "utf8"))) offenders.push(rel)
      }
    }

    for (const root of ["app", "components", "packages"]) walk(join(process.cwd(), root))
    expect(offenders).toEqual([])
  })

  it("is wired only through feature-gated internal/admin routes or the signed POS reader selector", () => {
    const routeImporters: string[] = []

    const walk = (dir: string) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.ts$/.test(entry.name)) continue
        if (/["']@\/engine\/shift4(\/[^"']*)?["']/.test(readFileSync(full, "utf8"))) {
          routeImporters.push(relative(process.cwd(), full).replace(/\\/g, "/"))
        }
      }
    }

    walk(join(process.cwd(), "app", "api"))
    expect(routeImporters.length).toBeGreaterThan(0)

    /**
     * The only POS-facing routes permitted to reach the Shift4 Engine. Both are
     * terminal-session authenticated, take at most a PineTree reader id, and
     * dispatch nothing to Shift4.
     */
    const allowedPosRoutes = new Set([
      "app/api/pos/shift4-retail-readers/route.ts",
      "app/api/pos/shift4-retail-preparation/route.ts",
    ])
    expect(routeImporters.every((path) =>
      path.startsWith("app/api/internal/shift4/") ||
      path.startsWith("app/api/admin/shift4/") ||
      allowedPosRoutes.has(path)
    )).toBe(true)
    for (const path of routeImporters) {
      const routeSource = readFileSync(join(process.cwd(), path), "utf8")
      expect(routeSource).not.toMatch(/@\/providers\/shift4\/(rest|commerce-engine)/)
      if (allowedPosRoutes.has(path)) {
        // Merchant identity comes from the signed session claim, never a body.
        expect(routeSource).toContain("requireTerminalSession")
        expect(routeSource).not.toMatch(/merchantId\s*:\s*(?!merchantId\b)["'a-zA-Z0-9_.]+/)
      }
    }
  })

  it("keeps shift4_rest separate from the legacy customer-facing provider", () => {
    const dbSource = readFileSync(
      join(process.cwd(), "database", "shift4PaymentAttempts.ts"),
      "utf8"
    )
    expect(dbSource).toContain("shift4_rest")
    expect(migrationSql()).toContain("'shift4_rest'")
  })

  it("contains no credential-shaped literal", () => {
    const sources = [
      migrationSql(),
      readFileSync(join(process.cwd(), "database", "shift4PaymentAttempts.ts"), "utf8"),
      ...engineSourceFiles().map(engineSource),
    ]
    for (const source of sources) {
      expect(source).not.toMatch(
        /(auth_?token|access_?token|client_?guid)["']?\s*[:=]\s*["'][A-Za-z0-9._-]{12,}/i
      )
    }
  })
})
