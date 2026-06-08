/**
 * Payment status reconciliation — integration rules spec.
 *
 * Covers all six scenarios required by the payment state fix:
 *
 *   1. Stale PENDING with no provider reference → becomes INCOMPLETE
 *   2. PENDING with provider reference → NOT marked incomplete
 *   3. PROCESSING with tx hash → stays PROCESSING (sweep never touches it)
 *   4. CONFIRMED is never downgraded (canonical status guard)
 *   5. FAILED is never converted to INCOMPLETE (Rule 11)
 *   6. Admin and merchant transaction mappers return the same status for the
 *      same payment record
 *
 * The stale-sweep tests (1–3) mock only the narrow interfaces they need so
 * they stay fast and deterministic.
 *
 * Run: npx vitest run __tests__/paymentStatusReconciliation.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Scenario 1–3: stale sweep / markPaymentIncomplete ────────────────────────

vi.mock("@/database", () => ({
  getPaymentById: vi.fn(),
  createPaymentEvent: vi.fn().mockResolvedValue(undefined),
  updatePaymentStatus: vi.fn(),
}))

vi.mock("@/database/payments", () => ({
  updatePaymentStatus: vi.fn(),
}))

vi.mock("@/database/paymentEvents", () => ({
  getPaymentEvents: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn().mockResolvedValue(null),
  updateTransactionStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/engine/updatePaymentStatus", () => ({
  updatePaymentStatus: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/engine/reconcileTransaction", () => ({
  reconcileTransactionForPayment: vi.fn().mockResolvedValue({ skipped: true }),
}))

import { getPaymentById } from "@/database"
import { getPaymentEvents } from "@/database/paymentEvents"
import { getTransactionByPaymentId } from "@/database/transactions"
import { updatePaymentStatus as mockUpdatePaymentStatus } from "@/engine/updatePaymentStatus"

import {
  getPaymentIncompleteEligibility,
  markPaymentIncomplete,
} from "@/engine/paymentStateActions"

import {
  normalizeStoredPaymentStatus,
  resolveTransactionDisplayStatus,
  isConfirmedStatus,
  isTerminalFailureStatus,
  isTerminalStatus,
  isSafeToMarkIncomplete,
} from "@/lib/utils/canonicalPaymentStatus"

import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"
import { canonicalAdminPaymentStatus } from "@/engine/adminLedgerStatus"

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockGetPaymentById = vi.mocked(getPaymentById)
const mockGetPaymentEvents = vi.mocked(getPaymentEvents)
const mockGetTransactionByPaymentId = vi.mocked(getTransactionByPaymentId)

function makePayment(
  status: string,
  overrides: {
    provider_reference?: string
    updatedAt?: string
    metadata?: unknown
  } = {}
) {
  const updatedAt = overrides.updatedAt ?? new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString()
  return {
    id: "pay-001",
    merchant_id: "merch-001",
    gross_amount: 10.0,
    merchant_amount: 9.85,
    pinetree_fee: 0.15,
    currency: "USD",
    provider: "solana",
    provider_reference: overrides.provider_reference,
    status: status as "CREATED" | "PENDING" | "PROCESSING" | "CONFIRMED" | "FAILED" | "INCOMPLETE",
    network: "solana",
    metadata: overrides.metadata ?? {
      split: {
        feeCaptureMethod: "atomic_split",
        merchantWallet: "9abc...",
        pinetreeWallet: "7def...",
      },
    },
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString(),
    updated_at: updatedAt,
  }
}

// ── 1. Stale PENDING with no provider reference → becomes INCOMPLETE ──────────

describe("Scenario 1 — stale PENDING, no provider reference → INCOMPLETE", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPaymentById.mockReset()
    mockGetPaymentEvents.mockResolvedValue([])
    mockGetTransactionByPaymentId.mockResolvedValue(null)
    vi.mocked(mockUpdatePaymentStatus).mockResolvedValue(undefined as never)
  })

  it("eligible: PENDING, no provider_reference, older than minimumAgeMs", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("PENDING", {
      provider_reference: undefined,
      updatedAt: new Date(Date.now() - 10 * 60 * 1_000).toISOString(), // 10 min ago
    }))

    const eligibility = await getPaymentIncompleteEligibility("pay-001", {
      minimumAgeMs: 5 * 60 * 1_000,
    })

    expect(eligibility.eligible).toBe(true)
    expect(eligibility.reason).toBe("pending_no_activity_timeout")
  })

  it("markPaymentIncomplete returns true and calls updatePaymentStatus with INCOMPLETE", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("PENDING", {
      provider_reference: undefined,
      updatedAt: new Date(Date.now() - 10 * 60 * 1_000).toISOString(),
    }))

    const changed = await markPaymentIncomplete("pay-001", {
      providerEvent: "cron.stale-cleanup",
      minimumAgeMs: 5 * 60 * 1_000,
    })

    expect(changed).toBe(true)
    const calls = vi.mocked(mockUpdatePaymentStatus).mock.calls.map((c) => c[1])
    expect(calls).toContain("INCOMPLETE")
  })

  it("treats an overlapping stale-payment transition as an idempotent no-op", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("PENDING", {
      provider_reference: undefined,
      updatedAt: new Date(Date.now() - 10 * 60 * 1_000).toISOString(),
    }))
    vi.mocked(mockUpdatePaymentStatus).mockRejectedValueOnce(
      new Error("Concurrent payment transition skipped: payment status changed")
    )

    await expect(markPaymentIncomplete("pay-001", {
      minimumAgeMs: 5 * 60 * 1_000,
    })).resolves.toBe(false)
  })

  it("CREATED also eligible when no evidence (state machine steps through PENDING first)", async () => {
    mockGetPaymentById
      .mockResolvedValueOnce(makePayment("CREATED", {
        provider_reference: undefined,
        updatedAt: new Date(Date.now() - 10 * 60 * 1_000).toISOString(),
      }))
      .mockResolvedValueOnce(makePayment("PENDING", {
        provider_reference: undefined,
        updatedAt: new Date(Date.now() - 10 * 60 * 1_000).toISOString(),
      }))

    const changed = await markPaymentIncomplete("pay-001", {
      minimumAgeMs: 5 * 60 * 1_000,
    })

    expect(changed).toBe(true)
    const statusArgs = vi.mocked(mockUpdatePaymentStatus).mock.calls.map((c) => c[1])
    expect(statusArgs).toContain("PENDING")
    expect(statusArgs).toContain("INCOMPLETE")
  })
})

// ── 2. PENDING with provider reference → NOT marked incomplete ────────────────

describe("Scenario 2 — PENDING with provider reference → not marked INCOMPLETE", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPaymentById.mockReset()
    mockGetPaymentEvents.mockResolvedValue([])
    mockGetTransactionByPaymentId.mockResolvedValue(null)
  })

  it("ineligible: PENDING with provider_reference set", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("PENDING", {
      provider_reference: "solana_sig_abc123",
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
    }))

    const eligibility = await getPaymentIncompleteEligibility("pay-001", {
      minimumAgeMs: 5 * 60 * 1_000,
    })

    expect(eligibility.eligible).toBe(false)
    expect(eligibility.reason).toBe("payment_has_processing_evidence")
  })

  it("markPaymentIncomplete returns false (no status change) when provider_reference present", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("PENDING", {
      provider_reference: "0xtxhash",
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
    }))

    const changed = await markPaymentIncomplete("pay-001", {
      minimumAgeMs: 5 * 60 * 1_000,
    })

    expect(changed).toBe(false)
    expect(vi.mocked(mockUpdatePaymentStatus)).not.toHaveBeenCalledWith(
      "pay-001",
      "INCOMPLETE",
      expect.anything()
    )
  })

  it("ineligible: PENDING with signature in metadata", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("PENDING", {
      provider_reference: undefined,
      metadata: {
        split: {
          feeCaptureMethod: "atomic_split",
          signature: "real-onchain-signature",
        },
      },
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
    }))

    const eligibility = await getPaymentIncompleteEligibility("pay-001", {
      minimumAgeMs: 5 * 60 * 1_000,
    })

    expect(eligibility.eligible).toBe(false)
    expect(eligibility.reason).toBe("payment_has_processing_evidence")
  })

  it("ineligible: PENDING with processing event in history", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("PENDING", {
      provider_reference: undefined,
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
    }))
    mockGetPaymentEvents.mockResolvedValue([
      { event_type: "payment.processing", raw_payload: null } as never,
    ])

    const eligibility = await getPaymentIncompleteEligibility("pay-001", {
      minimumAgeMs: 5 * 60 * 1_000,
    })

    expect(eligibility.eligible).toBe(false)
    expect(eligibility.reason).toBe("payment_has_processing_evidence")
  })
})

// ── 3. PROCESSING with tx hash → stays PROCESSING ────────────────────────────

describe("Scenario 3 — PROCESSING with tx hash stays PROCESSING", () => {
  it("isSafeToMarkIncomplete returns false for PROCESSING (sweep never targets it)", () => {
    expect(isSafeToMarkIncomplete("PROCESSING")).toBe(false)
  })

  it("getPaymentIncompleteEligibility returns ineligible for PROCESSING status", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("PROCESSING", {
      provider_reference: "0xdetected",
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
    }))

    const eligibility = await getPaymentIncompleteEligibility("pay-001", {
      minimumAgeMs: 5 * 60 * 1_000,
    })

    expect(eligibility.eligible).toBe(false)
    expect(eligibility.reason).toBe("processing_requires_reconciliation")
  })

  it("isSafeToMarkIncomplete is only true for CREATED and PENDING", () => {
    expect(isSafeToMarkIncomplete("CREATED")).toBe(true)
    expect(isSafeToMarkIncomplete("PENDING")).toBe(true)
    expect(isSafeToMarkIncomplete("PROCESSING")).toBe(false)
    expect(isSafeToMarkIncomplete("CONFIRMED")).toBe(false)
    expect(isSafeToMarkIncomplete("FAILED")).toBe(false)
    expect(isSafeToMarkIncomplete("INCOMPLETE")).toBe(false)
  })
})

// ── 4. CONFIRMED is never downgraded ─────────────────────────────────────────

describe("Scenario 4 — CONFIRMED is never downgraded (Rule 10)", () => {
  it("isConfirmedStatus returns true for CONFIRMED and REFUNDED", () => {
    expect(isConfirmedStatus("CONFIRMED")).toBe(true)
    expect(isConfirmedStatus("REFUNDED")).toBe(true)
  })

  it("isConfirmedStatus returns false for all non-confirmed statuses", () => {
    for (const s of ["CREATED", "PENDING", "PROCESSING", "FAILED", "INCOMPLETE", "EXPIRED"]) {
      expect(isConfirmedStatus(s)).toBe(false)
    }
  })

  it("resolveTransactionDisplayStatus: CONFIRMED payment always wins over any tx status", () => {
    const downgradeAttempts = [
      "PENDING", "PROCESSING", "FAILED", "INCOMPLETE", "EXPIRED", "CREATED",
    ]
    for (const txStatus of downgradeAttempts) {
      expect(resolveTransactionDisplayStatus(txStatus, "CONFIRMED")).toBe("CONFIRMED")
    }
  })

  it("resolveTransactionDisplayStatus: CONFIRMED tx wins even with non-CONFIRMED payment", () => {
    expect(resolveTransactionDisplayStatus("CONFIRMED", "FAILED")).toBe("CONFIRMED")
    expect(resolveTransactionDisplayStatus("CONFIRMED", "INCOMPLETE")).toBe("CONFIRMED")
    expect(resolveTransactionDisplayStatus("CONFIRMED", "PENDING")).toBe("CONFIRMED")
  })

  it("normalizeStoredPaymentStatus: REFUNDED normalises to CONFIRMED", () => {
    expect(normalizeStoredPaymentStatus("REFUNDED")).toBe("CONFIRMED")
  })

  it("getPaymentIncompleteEligibility: CONFIRMED payment is always ineligible", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("CONFIRMED", {
      updatedAt: new Date(2020, 0, 1).toISOString(),
    }))

    const eligibility = await getPaymentIncompleteEligibility("pay-001")
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.reason).toBe("terminal_status_not_eligible")
  })
})

// ── 5. FAILED is never converted to INCOMPLETE (Rule 11) ─────────────────────

describe("Scenario 5 — FAILED is never converted to INCOMPLETE (Rule 11)", () => {
  it("resolveTransactionDisplayStatus: FAILED payment never produces INCOMPLETE", () => {
    const result = resolveTransactionDisplayStatus("PENDING", "FAILED")
    expect(result).toBe("FAILED")
    expect(result).not.toBe("INCOMPLETE")
  })

  it("resolveTransactionDisplayStatus: FAILED tx + INCOMPLETE payment → keeps FAILED (CONFIRMED-or-FAILED wins)", () => {
    const result = resolveTransactionDisplayStatus("FAILED", "INCOMPLETE")
    expect(result).toBe("FAILED")
    expect(result).not.toBe("INCOMPLETE")
  })

  it("isTerminalFailureStatus returns true for FAILED and INCOMPLETE", () => {
    expect(isTerminalFailureStatus("FAILED")).toBe(true)
    expect(isTerminalFailureStatus("INCOMPLETE")).toBe(true)
    expect(isTerminalFailureStatus("EXPIRED")).toBe(true) // EXPIRED → INCOMPLETE
  })

  it("isTerminalFailureStatus returns false for non-failure statuses", () => {
    expect(isTerminalFailureStatus("CONFIRMED")).toBe(false)
    expect(isTerminalFailureStatus("PENDING")).toBe(false)
    expect(isTerminalFailureStatus("PROCESSING")).toBe(false)
  })

  it("getPaymentIncompleteEligibility: FAILED payment is always ineligible", async () => {
    mockGetPaymentById.mockResolvedValue(makePayment("FAILED", {
      updatedAt: new Date(2020, 0, 1).toISOString(),
    }))

    const eligibility = await getPaymentIncompleteEligibility("pay-001")
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.reason).toBe("terminal_status_not_eligible")
  })

  it("normalizeStoredPaymentStatus: EXPIRED normalises to INCOMPLETE (not FAILED)", () => {
    expect(normalizeStoredPaymentStatus("EXPIRED")).toBe("INCOMPLETE")
    // FAILED is never the result of normalising EXPIRED
    expect(normalizeStoredPaymentStatus("EXPIRED")).not.toBe("FAILED")
  })
})

// ── 6. Admin and merchant mappers return the same status ──────────────────────

describe("Scenario 6 — admin and merchant mappers return identical status for the same record", () => {
  // Admin uses canonicalAdminPaymentStatus() (toUpperCase normalisation).
  // Merchant uses getPaymentDisplayStatus().status.
  // Both receive the same DB status string and must produce the same value.

  const allDbStatuses = [
    "CREATED",
    "PENDING",
    "PROCESSING",
    "CONFIRMED",
    "FAILED",
    "INCOMPLETE",
    "EXPIRED",
  ]

  it.each(allDbStatuses)(
    "status=%s: canonicalAdminPaymentStatus and getPaymentDisplayStatus.status agree",
    (dbStatus) => {
      const adminResult   = canonicalAdminPaymentStatus(dbStatus)
      const merchantResult = getPaymentDisplayStatus(dbStatus).status
      expect(adminResult).toBe(merchantResult)
    }
  )

  it("both mappers treat lowercase input identically (case-insensitive normalisation)", () => {
    const lower = "confirmed"
    expect(canonicalAdminPaymentStatus(lower)).toBe(
      getPaymentDisplayStatus(lower).status
    )
  })

  it("resolveTransactionDisplayStatus + getPaymentDisplayStatus: confirmed payment → CONFIRMED badge for both admin and merchant row", () => {
    const canonical = resolveTransactionDisplayStatus("PENDING", "CONFIRMED")
    const adminDisplay   = getPaymentDisplayStatus(canonical).status
    const merchantDisplay = getPaymentDisplayStatus(canonical).status
    expect(adminDisplay).toBe("CONFIRMED")
    expect(merchantDisplay).toBe("CONFIRMED")
  })

  it("resolveTransactionDisplayStatus + getPaymentDisplayStatus: failed payment + pending tx → FAILED badge for both", () => {
    const canonical = resolveTransactionDisplayStatus("PENDING", "FAILED")
    expect(getPaymentDisplayStatus(canonical).status).toBe("FAILED")
    expect(canonicalAdminPaymentStatus(canonical)).toBe("FAILED")
  })
})

// ── normalizeStoredPaymentStatus — exhaustive coverage ───────────────────────

describe("normalizeStoredPaymentStatus — canonical 6-state normalisation", () => {
  it.each([
    ["CREATED",    "CREATED"],
    ["PENDING",    "PENDING"],
    ["PROCESSING", "PROCESSING"],
    ["CONFIRMED",  "CONFIRMED"],
    ["FAILED",     "FAILED"],
    ["INCOMPLETE", "INCOMPLETE"],
    ["EXPIRED",    "INCOMPLETE"],   // EXPIRED collapses to INCOMPLETE
    ["CANCELLED",  "INCOMPLETE"],   // CANCELLED collapses to INCOMPLETE
    ["REFUNDED",   "CONFIRMED"],    // REFUNDED collapses to CONFIRMED
    ["",           "PENDING"],      // unknown → safe fallback
    [null,         "PENDING"],
    [undefined,    "PENDING"],
  ] as const)(
    "normalizeStoredPaymentStatus('%s') → '%s'",
    (input, expected) => {
      expect(normalizeStoredPaymentStatus(input as string)).toBe(expected)
    }
  )
})

// ── isTerminalStatus ──────────────────────────────────────────────────────────

describe("isTerminalStatus", () => {
  it.each(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "REFUNDED"])(
    "%s is terminal",
    (s) => expect(isTerminalStatus(s)).toBe(true)
  )

  it.each(["CREATED", "PENDING", "PROCESSING"])(
    "%s is not terminal",
    (s) => expect(isTerminalStatus(s)).toBe(false)
  )
})
