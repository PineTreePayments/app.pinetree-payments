import { beforeEach, describe, expect, it, vi } from "vitest"

type QueryCall = { method: string; args: unknown[] }
type QueryRecord = { table: string; calls: QueryCall[] }
type QueryResult = { data: unknown[]; error: { message: string } | null }

const queryMock = vi.hoisted(() => {
  const state = {
    queries: [] as QueryRecord[],
    resolve: vi.fn<(query: QueryRecord) => QueryResult>(() => ({ data: [], error: null })),
  }
  const from = vi.fn((table: string) => {
    const query: QueryRecord = { table, calls: [] }
    state.queries.push(query)

    const builder: Record<string, unknown> = {}
    for (const method of [
      "select",
      "in",
      "lt",
      "gte",
      "not",
      "or",
      "is",
      "eq",
      "neq",
      "order",
      "limit",
      "range",
    ]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push({ method, args })
        return builder
      }
    }
    builder.then = (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown
    ) => Promise.resolve(state.resolve(query)).then(onFulfilled, onRejected)
    return builder
  })

  return { from, state }
})

vi.mock("@/database/supabase", () => ({
  supabaseAdmin: { from: queryMock.from },
  supabase: null,
}))

vi.mock("@/database/merchantProviders", () => ({
  SPEED_PROVIDER_NAME: "lightning_speed",
}))

import {
  getLightningReconciliationCandidates,
  getStalePaymentMaintenanceCandidates,
  getTerminalPaymentMaintenanceCandidates,
} from "@/database/paymentMaintenance"

function calls(query: QueryRecord, method: string): unknown[][] {
  return query.calls.filter((call) => call.method === method).map((call) => call.args)
}

function selectText(query: QueryRecord): string {
  return String(calls(query, "select")[0]?.[0] || "")
}

function statusFilter(query: QueryRecord): string {
  return String(calls(query, "eq").find(([field]) => field === "status")?.[1] || "")
}

describe("payment maintenance database candidate queries", () => {
  beforeEach(() => {
    queryMock.from.mockClear()
    queryMock.state.queries.length = 0
    queryMock.state.resolve.mockReset()
    queryMock.state.resolve.mockReturnValue({ data: [], error: null })
  })

  it("keeps null-root and every legacy Lightning alias out of the generic stale sweep", async () => {
    await getStalePaymentMaintenanceCandidates({
      cutoff: "2026-07-28T00:00:00.000Z",
      limit: 10,
      offset: 0,
    })

    const [query] = queryMock.state.queries
    expect(calls(query, "not")).toEqual(expect.arrayContaining([
      ["network", "is", null],
      ["provider", "is", null],
      ["network", "in", "(bitcoin_lightning,btc_lightning,lightning_btc,lightning)"],
      ["provider", "in", "(lightning_speed,speed,tryspeed,lightning_nwc,nwc,lightning)"],
    ]))
  })

  it("merges null-root transaction-attempt evidence without permanently excluding stale references", async () => {
    queryMock.state.resolve.mockImplementation((query) => {
      if (selectText(query).includes("transactions!inner")) {
        return {
          data: [{
            id: "pay-null-root",
            status: "PENDING",
            provider: null,
            network: null,
            updated_at: "2026-07-28T00:00:00.000Z",
            transactions: [{ provider: "speed", network: "btc_lightning" }],
          }],
          error: null,
        }
      }
      return {
        data: [{
          id: "pay-direct",
          status: "PENDING",
          provider: "lightning_speed",
          network: "bitcoin_lightning",
          updated_at: "2026-07-28T00:01:00.000Z",
        }],
        error: null,
      }
    })

    const result = await getLightningReconciliationCandidates({
      cutoff: "2026-07-28T00:03:00.000Z",
      limit: 2,
    })

    expect(result.map((payment) => payment.id)).toEqual(["pay-null-root", "pay-direct"])
    const [directQuery, relatedQuery] = queryMock.state.queries
    const exhaustedFilter =
      "metadata->>speedRetrieveStale.neq.true," +
      "metadata->>speedRetrieveStale.is.null," +
      "metadata->>speedLegacyPlatformFallbackCheckedAt.is.null"
    expect(calls(directQuery, "or")).toContainEqual([
      "network.in.(bitcoin_lightning,btc_lightning,lightning_btc,lightning)," +
        "provider.in.(lightning_speed,speed,tryspeed)"
    ])
    expect(calls(directQuery, "or")).not.toContainEqual([exhaustedFilter])
    expect(calls(relatedQuery, "or")).toContainEqual(["network.is.null,provider.is.null"])
    expect(calls(relatedQuery, "or")).toContainEqual([
      "network.in.(bitcoin_lightning,btc_lightning,lightning_btc,lightning)," +
        "provider.in.(lightning_speed,speed,tryspeed)",
      { referencedTable: "transactions" },
    ])
    expect(calls(relatedQuery, "or")).not.toContainEqual([exhaustedFilter])
  })

  it("selects EXPIRED and CANCELED transaction mismatches and orders every status globally", async () => {
    const rows: Record<string, Array<Record<string, unknown>>> = {
      CONFIRMED: [{ id: "pay-confirmed", status: "CONFIRMED", updated_at: "2026-07-28T00:03:00.000Z" }],
      EXPIRED: [{ id: "pay-expired", status: "EXPIRED", updated_at: "2026-07-28T00:01:00.000Z" }],
      CANCELED: [{ id: "pay-canceled", status: "CANCELED", updated_at: "2026-07-28T00:00:00.000Z" }],
    }
    queryMock.state.resolve.mockImplementation((query) => ({
      data: rows[statusFilter(query)] || [],
      error: null,
    }))

    const result = await getTerminalPaymentMaintenanceCandidates(2)

    expect(result).toEqual([
      { id: "pay-canceled", status: "CANCELED" },
      { id: "pay-expired", status: "EXPIRED" },
    ])
    for (const status of ["EXPIRED", "CANCELED", "CANCELLED"]) {
      const query = queryMock.state.queries.find((candidate) => statusFilter(candidate) === status)
      expect(query).toBeDefined()
      expect(calls(query!, "neq")).toContainEqual(["transactions.status", "INCOMPLETE"])
      expect(calls(query!, "limit")).toContainEqual([2])
    }
  })
})
