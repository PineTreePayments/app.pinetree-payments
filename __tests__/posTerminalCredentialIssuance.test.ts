/**
 * RA-1 regression: the terminal session credential is issued only after PIN
 * verification.
 *
 * Before the fix, GET /api/pos/terminal-session signed and returned a 24-hour
 * `pts_` terminal token to any caller who knew a terminal id, bypassing the PIN
 * gate on POST /api/pos/terminal-auth and unlocking ~30 POS and card route
 * methods including Stripe and Shift4 authorization.
 *
 * These tests run the REAL route handlers against the REAL engine and the REAL
 * HMAC signer. Only the database, the cash-drawer read, and one unrelated
 * pricing engine are mocked, so the assertions below are about actual behavior
 * rather than about mocks agreeing with each other.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

const mocks = vi.hoisted(() => {
  const state = {
    terminals: { data: null, error: null } as { data: unknown; error: unknown },
    wallets: { data: null, error: null } as { data: unknown; error: unknown },
  }

  /**
   * Minimal Supabase query-builder stand-in, resolved per table so one mock
   * serves both the bootstrap read and the PIN read. Defined inside vi.hoisted
   * because the module mock factory below is hoisted above module scope.
   */
  const db = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        single: async () => (table === "terminals" ? state.terminals : { data: null, error: null }),
        maybeSingle: async () => (table === "merchant_wallets" ? state.wallets : { data: null, error: null }),
      }
      return chain
    },
  }

  return {
    signTerminalSession: vi.fn(),
    getDrawerState: vi.fn(),
    previewPosBreakdownEngine: vi.fn(),
    state,
    db,
  }
})

vi.mock("@/database", () => ({ supabaseAdmin: mocks.db, supabase: mocks.db }))
vi.mock("@/engine/cashDrawer", () => ({ getDrawerState: mocks.getDrawerState }))
vi.mock("@/engine/posPayments", () => ({ previewPosBreakdownEngine: mocks.previewPosBreakdownEngine }))

// Keep the real signer and verifier, but route signing through a spy so we can
// prove the GET path never reaches it. Real HMAC means the issued token is a
// genuine credential we can verify claims against.
vi.mock("@/lib/api/terminalAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/terminalAuth")>()
  mocks.signTerminalSession.mockImplementation(actual.signTerminalSession)
  return { ...actual, signTerminalSession: mocks.signTerminalSession }
})

vi.mock("@/engine/posTerminals", () => ({
  resetPosTerminalPinWithRecoveryEngine: vi.fn(),
}))

import { NextRequest } from "next/server"
import { GET as terminalSessionGET } from "@/app/api/pos/terminal-session/route"
import { POST as terminalAuthPOST } from "@/app/api/pos/terminal-auth/route"
import { GET as breakdownGET } from "@/app/api/pos/breakdown/route"
import { verifyTerminalSession } from "@/lib/api/terminalAuth"

const MERCHANT_ID = "11111111-1111-4111-8111-111111111111"

function terminalRow(id: string, pin = "4321") {
  return {
    data: {
      id,
      name: "Front Register",
      autolock: "5",
      pin,
      merchant_id: MERCHANT_ID,
      drawer_starting_amount: 200,
      tax_mode: "none",
      tax_rate: null,
      tax_label: "Sales tax",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    error: null,
  }
}

function bootstrapRequest(tid: string | null) {
  const url = tid === null
    ? "http://localhost/api/pos/terminal-session"
    : `http://localhost/api/pos/terminal-session?tid=${encodeURIComponent(tid)}`
  return new NextRequest(url, { method: "GET" })
}

function pinRequest(body: unknown) {
  return new NextRequest("http://localhost/api/pos/terminal-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeAll(() => {
  // The signer refuses to run without a secret, by design.
  process.env.TERMINAL_SESSION_SECRET = "ra1-regression-terminal-secret"
})

beforeEach(() => {
  mocks.signTerminalSession.mockClear()
  mocks.getDrawerState.mockReset()
  mocks.previewPosBreakdownEngine.mockReset()
  mocks.getDrawerState.mockResolvedValue({
    balance: 512.5,
    active: true,
    lastEntry: { type: "closeout", created_at: "2026-02-01T00:00:00.000Z" },
  })
  mocks.state.terminals = { data: null, error: null }
  mocks.state.wallets = { data: { network: "base" }, error: null }
})

/* ── The unauthenticated bootstrap issues no credential ──────────────────── */

describe("GET /api/pos/terminal-session issues no terminal credential", () => {
  it("returns bootstrap display data without a sessionToken", async () => {
    mocks.state.terminals = terminalRow("t-bootstrap-1")

    const res = await terminalSessionGET(bootstrapRequest("t-bootstrap-1"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body).not.toHaveProperty("sessionToken")
    expect(body.terminal).toMatchObject({ id: "t-bootstrap-1", name: "Front Register" })
  })

  it("contains no pts_ credential anywhere in the serialized response", async () => {
    mocks.state.terminals = terminalRow("t-bootstrap-2")

    const res = await terminalSessionGET(bootstrapRequest("t-bootstrap-2"))
    const raw = JSON.stringify(await res.json())

    expect(raw).not.toContain("pts_")
    expect(raw).not.toMatch(/sessionToken/i)
  })

  it("never calls signTerminalSession on the GET path", async () => {
    mocks.state.terminals = terminalRow("t-bootstrap-3")

    await terminalSessionGET(bootstrapRequest("t-bootstrap-3"))

    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("does not leak the PIN, the merchant binding, or the drawer cash balance", async () => {
    mocks.state.terminals = terminalRow("t-bootstrap-4", "9876")

    const res = await terminalSessionGET(bootstrapRequest("t-bootstrap-4"))
    const body = await res.json()
    const raw = JSON.stringify(body)

    expect(raw).not.toContain("9876")
    expect(raw).not.toContain(MERCHANT_ID)
    expect(body.terminal).not.toHaveProperty("pin")
    expect(body.terminal).not.toHaveProperty("merchant_id")
    expect(body.drawer).not.toHaveProperty("balance")
    // Shift state is still available so the POS can decide what to show later.
    expect(body.drawer).toMatchObject({ active: true, lastEntryType: "closeout" })
  })

  it("rejects a missing terminal id without signing anything", async () => {
    const res = await terminalSessionGET(bootstrapRequest(null))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/missing terminal id/i)
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("produces no token for an unknown terminal", async () => {
    mocks.state.terminals = { data: null, error: { message: "no rows" } }

    const res = await terminalSessionGET(bootstrapRequest("t-does-not-exist"))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(raw).not.toContain("pts_")
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })
})

/* ── PIN verification is the only issuing boundary ───────────────────────── */

describe("POST /api/pos/terminal-auth is the credential-issuing boundary", () => {
  it("issues a pts_ token for a correct PIN", async () => {
    mocks.state.terminals = terminalRow("t-pin-ok", "4321")

    const res = await terminalAuthPOST(pinRequest({ terminalId: "t-pin-ok", pin: "4321" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(String(body.sessionToken)).toMatch(/^pts_/)
    expect(mocks.signTerminalSession).toHaveBeenCalledTimes(1)
  })

  it("scopes the issued token to the verified merchant and terminal", async () => {
    mocks.state.terminals = terminalRow("t-pin-claims", "4321")

    const res = await terminalAuthPOST(pinRequest({ terminalId: "t-pin-claims", pin: "4321" }))
    const body = await res.json()
    const claims = verifyTerminalSession(String(body.sessionToken))

    expect(claims.mid).toBe(MERCHANT_ID)
    expect(claims.tid).toBe("t-pin-claims")
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    // Identity travels with the verified credential, not the public bootstrap.
    expect(body.merchantId).toBe(MERCHANT_ID)
    expect(body.terminalId).toBe("t-pin-claims")
  })

  it("returns no token for an incorrect PIN", async () => {
    mocks.state.terminals = terminalRow("t-pin-wrong", "4321")

    const res = await terminalAuthPOST(pinRequest({ terminalId: "t-pin-wrong", pin: "0000" }))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBe(401)
    expect(raw).not.toContain("pts_")
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("returns no token for a malformed PIN", async () => {
    mocks.state.terminals = terminalRow("t-pin-malformed", "4321")

    for (const pin of ["", "12", "12345", "abcd", "12a4"]) {
      mocks.signTerminalSession.mockClear()
      const res = await terminalAuthPOST(pinRequest({ terminalId: "t-pin-malformed", pin }))
      const raw = JSON.stringify(await res.json())

      expect(res.status, `pin ${JSON.stringify(pin)}`).toBe(400)
      expect(raw).not.toContain("pts_")
      expect(mocks.signTerminalSession).not.toHaveBeenCalled()
    }
  })

  it("returns no token when the terminal does not exist", async () => {
    mocks.state.terminals = { data: null, error: { message: "no rows" } }

    const res = await terminalAuthPOST(pinRequest({ terminalId: "t-pin-missing", pin: "4321" }))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBe(404)
    expect(raw).not.toContain("pts_")
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("rejects a missing terminal id", async () => {
    const res = await terminalAuthPOST(pinRequest({ pin: "4321" }))
    expect(res.status).toBe(400)
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("keeps the PIN rate limiter active", async () => {
    // Dedicated terminal id: the limiter is module state shared across this file.
    const tid = "t-pin-ratelimited"
    mocks.state.terminals = terminalRow(tid, "4321")

    const statuses: number[] = []
    for (let attempt = 0; attempt < 7; attempt++) {
      const res = await terminalAuthPOST(pinRequest({ terminalId: tid, pin: "0000" }))
      statuses.push(res.status)
    }

    expect(statuses.filter((s) => s === 401).length).toBe(5)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)

    // A locked-out terminal cannot obtain a token even with the correct PIN.
    const blocked = await terminalAuthPOST(pinRequest({ terminalId: tid, pin: "4321" }))
    const raw = JSON.stringify(await blocked.json())
    expect(blocked.status).toBe(429)
    expect(raw).not.toContain("pts_")
  })
})

/* ── A protected POS route still requires the credential ─────────────────── */

describe("protected POS routes require a verified terminal session", () => {
  it("rejects a request with no terminal token", async () => {
    const res = await breakdownGET(
      new NextRequest("http://localhost/api/pos/breakdown?amount=25", { method: "GET" })
    )

    expect(res.status).toBe(401)
    expect(mocks.previewPosBreakdownEngine).not.toHaveBeenCalled()
  })

  it("rejects a forged terminal token", async () => {
    const res = await breakdownGET(
      new NextRequest("http://localhost/api/pos/breakdown?amount=25", {
        method: "GET",
        headers: { authorization: "Bearer pts_forged.signature" },
      })
    )

    expect(res.status).toBe(401)
    expect(mocks.previewPosBreakdownEngine).not.toHaveBeenCalled()
  })

  it("accepts the token issued after valid PIN authentication", async () => {
    mocks.state.terminals = terminalRow("t-end-to-end", "4321")
    mocks.previewPosBreakdownEngine.mockResolvedValue({ total: 25, tax: 0 })

    const authRes = await terminalAuthPOST(pinRequest({ terminalId: "t-end-to-end", pin: "4321" }))
    const { sessionToken } = await authRes.json()

    const res = await breakdownGET(
      new NextRequest("http://localhost/api/pos/breakdown?amount=25", {
        method: "GET",
        headers: { authorization: `Bearer ${sessionToken}` },
      })
    )

    expect(res.status).toBe(200)
    expect(mocks.previewPosBreakdownEngine).toHaveBeenCalledWith(MERCHANT_ID, "t-end-to-end", 25)
  })

  it("cannot be reached with anything the bootstrap route returns", async () => {
    mocks.state.terminals = terminalRow("t-bootstrap-reuse", "4321")
    const bootstrap = await (await terminalSessionGET(bootstrapRequest("t-bootstrap-reuse"))).json()

    // Every string the bootstrap hands out, tried as a bearer token.
    const candidates = Object.values(bootstrap.terminal as Record<string, unknown>)
      .concat(Object.values(bootstrap.drawer as Record<string, unknown>), [bootstrap.provider])
      .filter((v): v is string => typeof v === "string" && v.length > 0)

    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      const res = await breakdownGET(
        new NextRequest("http://localhost/api/pos/breakdown?amount=25", {
          method: "GET",
          headers: { authorization: `Bearer ${candidate}` },
        })
      )
      expect(res.status, `bootstrap value must not authenticate: ${candidate}`).toBe(401)
    }
  })
})

/* ── The POS client does not expect a bootstrap credential ───────────────── */

describe("POS terminal client requires PIN before any protected call", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/(pos)/terminal/TerminalInnerr.tsx"),
    "utf8"
  )

  it("does not read a sessionToken from the bootstrap response", () => {
    expect(source).not.toMatch(/payload\.sessionToken/)
    expect(source).not.toMatch(/payload\?\.sessionToken/)
  })

  it("establishes the terminal context only from the PIN-auth response", () => {
    const assignments = [...source.matchAll(/setTerminalContext\(/g)]
    expect(assignments.length, "exactly one place may establish a terminal session").toBe(1)

    // That one call site must sit after the terminal-auth fetch in the same handler.
    const authIndex = source.indexOf("/api/pos/terminal-auth")
    const contextIndex = source.indexOf("setTerminalContext(")
    expect(authIndex).toBeGreaterThan(-1)
    expect(contextIndex).toBeGreaterThan(authIndex)
  })

  it("gates the POS surface on holding a verified session, not just the lock flag", () => {
    expect(source).toContain("const hasTerminalSession = Boolean(terminalContext?.sessionToken)")
    expect(source).toContain("const needsPin = unlockMode || !hasTerminalSession")
    // The POS and shift screens must be gated on needsPin, never on unlockMode alone.
    expect(source).toContain("{!needsPin && (shiftStarted")
    expect(source).toMatch(/\{needsPin && \(/)
    expect(source).not.toMatch(/\{!unlockMode && \(shiftStarted/)
  })

  it("still sends the terminal token on the protected shift-start call", () => {
    expect(source).toContain("/api/pos/drawer/open")
    expect(source).toContain("Authorization: `Bearer ${terminalContext.sessionToken}`")
    expect(source).toContain("if (!terminal?.id || !terminalContext?.sessionToken) return")
  })
})
