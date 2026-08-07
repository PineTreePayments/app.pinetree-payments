/**
 * RA-4 regression: cross-merchant Base POS session access.
 *
 * Before the fix, `POST /api/pos/base-session/[intentId]` called
 * `requireTerminalSession` but discarded its return value, loaded the intent by
 * id alone, and updated it through the service-role client scoped only by `id`.
 * Any valid terminal session could therefore overwrite or clear any merchant's
 * `pos_base_session` — including substituting the `pairingUri` that the public
 * GET mirror serves to the paying customer's hosted checkout.
 *
 * These tests exercise the real route handler with the real HMAC terminal-session
 * verifier. Only the database is mocked, and the mock records every `.eq()` filter
 * so the tests can prove the service-role writes are merchant-scoped rather than
 * merely assuming it.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const MERCHANT_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const MERCHANT_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
const TERMINAL_A = "term-aaaa-1111"
const TERMINAL_B = "term-bbbb-2222"

type UpdateRecord = { table: string; eqs: Record<string, string>; payload: Record<string, unknown> | null }

const mocks = vi.hoisted(() => {
  const state = {
    /** Intent rows keyed by `${intentId}` for the unscoped read. */
    intent: null as Record<string, unknown> | null,
    updates: [] as Array<{ table: string; eqs: Record<string, string>; payload: Record<string, unknown> | null }>,
    updateError: null as { message: string } | null,
  }

  const supabaseAdmin = {
    from(table: string) {
      const record: UpdateRecord = { table, eqs: {}, payload: null }
      state.updates.push(record)
      const chain = {
        update(payload: Record<string, unknown>) {
          record.payload = payload
          return chain
        },
        eq(column: string, value: string) {
          record.eqs[column] = value
          return chain
        },
        then<T>(resolve: (v: { error: { message: string } | null }) => T) {
          return Promise.resolve({ error: state.updateError }).then(resolve)
        },
      }
      return chain
    },
  }

  return {
    getPaymentIntentById: vi.fn(),
    getPaymentIntentForMerchant: vi.fn(),
    state,
    supabaseAdmin,
  }
})

vi.mock("@/database", () => ({
  getPaymentIntentById: mocks.getPaymentIntentById,
  getPaymentIntentForMerchant: mocks.getPaymentIntentForMerchant,
}))
vi.mock("@/database/supabase", () => ({
  supabaseAdmin: mocks.supabaseAdmin,
  supabase: mocks.supabaseAdmin,
}))

import { NextRequest } from "next/server"
import { POST, GET } from "@/app/api/pos/base-session/[intentId]/route"
import { signTerminalSession } from "@/lib/api/terminalAuth"

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    merchant_id: MERCHANT_A,
    terminal_id: TERMINAL_A,
    amount: 25,
    currency: "USD",
    metadata: {},
    ...overrides,
  }
}

function postRequest(intentId: string, body: unknown, token?: string) {
  return new NextRequest(`http://localhost/api/pos/base-session/${intentId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const params = (intentId: string) => ({ params: Promise.resolve({ intentId }) })

beforeAll(() => {
  process.env.TERMINAL_SESSION_SECRET = "ra4-base-session-secret"
})

beforeEach(() => {
  mocks.getPaymentIntentById.mockReset()
  mocks.getPaymentIntentForMerchant.mockReset()
  mocks.state.intent = null
  mocks.state.updates = []
  mocks.state.updateError = null

  // Default: the merchant-scoped read behaves like the real query — it returns
  // the row only when merchant_id matches.
  mocks.getPaymentIntentForMerchant.mockImplementation(async (id: string, merchantId: string) => {
    const row = mocks.state.intent
    if (!row) return null
    if (String(row.id) !== id) return null
    if (String(row.merchant_id) !== merchantId) return null
    return row
  })
  mocks.getPaymentIntentById.mockImplementation(async () => mocks.state.intent)
})

/* ── Authentication ──────────────────────────────────────────────────────── */

describe("POST base-session requires a terminal session", () => {
  it("rejects a missing terminal token and writes nothing", async () => {
    mocks.state.intent = intentRow()

    const res = await POST(postRequest("intent-1", { step: "confirming" }), params("intent-1"))

    expect(res.status).toBe(401)
    expect(mocks.state.updates).toEqual([])
    expect(mocks.getPaymentIntentForMerchant).not.toHaveBeenCalled()
  })

  it("rejects a forged terminal token and writes nothing", async () => {
    mocks.state.intent = intentRow()

    const res = await POST(
      postRequest("intent-1", { step: "confirming" }, "pts_forged.signature"),
      params("intent-1")
    )

    expect(res.status).toBe(401)
    expect(mocks.state.updates).toEqual([])
  })
})

/* ── Merchant ownership ──────────────────────────────────────────────────── */

describe("POST base-session enforces merchant ownership", () => {
  it("allows a terminal to write its own merchant's intent", async () => {
    mocks.state.intent = intentRow()

    const res = await POST(
      postRequest("intent-1", { step: "confirming", pairingUri: "wc:abc@2" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.session).toMatchObject({
      controller: "pos_terminal",
      step: "confirming",
      pairingUri: "wc:abc@2",
    })
  })

  it("refuses another merchant's intent with a non-disclosing 404", async () => {
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_B, terminal_id: TERMINAL_B })

    const res = await POST(
      postRequest("intent-1", { step: "confirming", pairingUri: "wc:attacker@2" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    // Same wording as a genuinely missing intent — existence is not disclosed.
    expect(body.error).toBe("Payment intent not found")
    expect(JSON.stringify(body)).not.toContain(MERCHANT_B)
  })

  it("refuses a foreign merchant's intent even when the terminal id matches", async () => {
    // Isolates the merchant guard. The other cross-merchant cases are also caught
    // by the terminal-binding check, so this one uses a foreign intent carrying
    // the attacker's own terminal id — only merchant ownership can refuse it.
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_B, terminal_id: TERMINAL_A })

    const res = await POST(
      postRequest("intent-1", { step: "confirming", pairingUri: "wc:attacker@2" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(res.status).toBe(404)
    expect(mocks.state.updates).toEqual([])
  })

  it("refuses a clear:true wipe of a foreign intent whose terminal id matches", async () => {
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_B, terminal_id: TERMINAL_A })

    const res = await POST(
      postRequest("intent-1", { clear: true }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(res.status).toBe(404)
    expect(mocks.state.updates).toEqual([])
  })

  it("performs no database write after an ownership failure", async () => {
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_B, terminal_id: TERMINAL_B })

    await POST(
      postRequest("intent-1", { step: "confirming" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(mocks.state.updates).toEqual([])
  })

  it("refuses a clear:true wipe of another merchant's intent", async () => {
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_B, terminal_id: TERMINAL_B })

    const res = await POST(
      postRequest("intent-1", { clear: true }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(res.status).toBe(404)
    expect(mocks.state.updates).toEqual([])
  })

  it("uses the verified mid claim as the lookup scope", async () => {
    mocks.state.intent = intentRow()

    await POST(
      postRequest("intent-1", { step: "confirming" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(mocks.getPaymentIntentForMerchant).toHaveBeenCalledWith("intent-1", MERCHANT_A)
    // The unscoped helper must not be used on this path any more.
    expect(mocks.getPaymentIntentById).not.toHaveBeenCalled()
  })

  it("returns 404 when the intent does not exist at all", async () => {
    mocks.state.intent = null

    const res = await POST(
      postRequest("intent-nope", { step: "confirming" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-nope")
    )

    expect(res.status).toBe(404)
    expect(mocks.state.updates).toEqual([])
  })
})

/* ── Terminal ownership ──────────────────────────────────────────────────── */

describe("POST base-session enforces terminal binding", () => {
  it("refuses an intent bound to a different terminal of the same merchant", async () => {
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_A, terminal_id: TERMINAL_B })

    const res = await POST(
      postRequest("intent-1", { step: "confirming" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(res.status).toBe(404)
    expect(mocks.state.updates).toEqual([])
  })

  it("uses the verified tid claim, not a body-supplied terminal id", async () => {
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_A, terminal_id: TERMINAL_B })

    // The caller claims to be TERMINAL_B in the body while holding TERMINAL_A's
    // token. The body is not consulted, so this is still refused.
    const res = await POST(
      postRequest(
        "intent-1",
        { step: "confirming", terminal_id: TERMINAL_B, terminalId: TERMINAL_B, tid: TERMINAL_B },
        signTerminalSession(MERCHANT_A, TERMINAL_A)
      ),
      params("intent-1")
    )

    expect(res.status).toBe(404)
    expect(mocks.state.updates).toEqual([])
  })

  it("allows a null terminal_id intent for the same merchant (documented decision)", async () => {
    // Intents created outside the POS (hosted checkout, public API) carry no
    // terminal binding. They stay merchant-scoped only; there is no terminal to
    // match against, and refusing them would break the legitimate flow where a
    // terminal presents a non-POS intent.
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_A, terminal_id: null })

    const res = await POST(
      postRequest("intent-1", { step: "wallet_connected" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(res.status).toBe(200)
  })

  it("still refuses a null terminal_id intent belonging to another merchant", async () => {
    mocks.state.intent = intentRow({ merchant_id: MERCHANT_B, terminal_id: null })

    const res = await POST(
      postRequest("intent-1", { step: "wallet_connected" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(res.status).toBe(404)
    expect(mocks.state.updates).toEqual([])
  })
})

/* ── Service-role scoping ────────────────────────────────────────────────── */

describe("service-role writes cannot bypass ownership", () => {
  it("scopes the session update by both id and merchant_id", async () => {
    mocks.state.intent = intentRow()

    await POST(
      postRequest("intent-1", { step: "confirming" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(mocks.state.updates).toHaveLength(1)
    expect(mocks.state.updates[0].table).toBe("payment_intents")
    expect(mocks.state.updates[0].eqs).toEqual({ id: "intent-1", merchant_id: MERCHANT_A })
  })

  it("scopes the clear update by both id and merchant_id", async () => {
    mocks.state.intent = intentRow({ metadata: { pos_base_session: { controller: "pos_terminal" } } })

    const res = await POST(
      postRequest("intent-1", { clear: true }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )

    expect(res.status).toBe(200)
    expect(mocks.state.updates).toHaveLength(1)
    expect(mocks.state.updates[0].eqs).toEqual({ id: "intent-1", merchant_id: MERCHANT_A })
    // The session key is removed rather than the whole metadata object replaced.
    expect(mocks.state.updates[0].payload?.metadata).toEqual({})
  })

  it("never writes a caller-supplied merchant id into the row", async () => {
    mocks.state.intent = intentRow()

    await POST(
      postRequest(
        "intent-1",
        { step: "confirming", merchant_id: MERCHANT_B, merchantId: MERCHANT_B },
        signTerminalSession(MERCHANT_A, TERMINAL_A)
      ),
      params("intent-1")
    )

    const write = mocks.state.updates[0]
    expect(write.eqs.merchant_id).toBe(MERCHANT_A)
    expect(JSON.stringify(write.payload)).not.toContain(MERCHANT_B)
  })
})

/* ── Existing behaviour preserved ────────────────────────────────────────── */

describe("valid same-merchant flow is unchanged", () => {
  it("returns the expected response shape and merges onto the existing session", async () => {
    mocks.state.intent = intentRow({
      metadata: {
        pos_base_session: { controller: "pos_terminal", selectedAsset: "USDC", pairingUri: "wc:existing@2" },
        unrelated: "keep-me",
      },
    })

    const res = await POST(
      postRequest("intent-1", { step: "payment_submitted", txHash: "0xabc" }, signTerminalSession(MERCHANT_A, TERMINAL_A)),
      params("intent-1")
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(body.session).toMatchObject({
      controller: "pos_terminal",
      step: "payment_submitted",
      txHash: "0xabc",
      // Untouched fields survive the merge.
      selectedAsset: "USDC",
      pairingUri: "wc:existing@2",
    })
    // Unrelated metadata is preserved.
    const written = mocks.state.updates[0].payload?.metadata as Record<string, unknown>
    expect(written.unrelated).toBe("keep-me")
  })

  it("still rejects an invalid step and an invalid pairing URI before writing", async () => {
    mocks.state.intent = intentRow()
    const token = signTerminalSession(MERCHANT_A, TERMINAL_A)

    const badStep = await POST(postRequest("intent-1", { step: "not_a_step" }, token), params("intent-1"))
    expect(badStep.status).toBe(400)

    const badUri = await POST(postRequest("intent-1", { pairingUri: "https://evil" }, token), params("intent-1"))
    expect(badUri.status).toBe(400)

    expect(mocks.state.updates).toEqual([])
  })

  it("leaves the public GET mirror reachable without a terminal token", async () => {
    // GET is an intentionally public mirror for the customer's hosted checkout.
    // RA-4 was about POST; this asserts the fix did not change GET.
    mocks.state.intent = intentRow({
      metadata: { pos_base_session: { controller: "pos_terminal", pairingUri: "wc:abc@2", step: "confirming" } },
    })

    const res = await GET(
      new NextRequest("http://localhost/api/pos/base-session/intent-1"),
      params("intent-1")
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.session).toMatchObject({ controller: "pos_terminal", pairingUri: "wc:abc@2" })
  })
})
