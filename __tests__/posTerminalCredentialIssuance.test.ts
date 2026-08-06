/**
 * PineTree terminal credential contract (audit finding RA-1).
 *
 * The product rule and the security rule are different things, and this suite
 * pins both:
 *
 *   Product — launching a configured terminal opens the POS immediately. A
 *   cashier never types a PIN to start selling. The PIN authorizes *leaving* the
 *   terminal.
 *
 *   Security — a terminal session credential is minted only for a caller with a
 *   server-verified merchant session who provably owns the terminal. Terminal id
 *   possession is not authorization.
 *
 * RA-1 was that the launch route signed a 24-hour `pts_` token for anyone who
 * knew a terminal id. What closes it is the merchant session plus the ownership
 * check — not a PIN prompt. An earlier fix mistakenly turned the PIN into an
 * entry gate; the tests that encoded that behavior were removed rather than kept.
 *
 * Real route handlers, real engine, real HMAC signer. Only the database, the
 * cash-drawer read, one pricing engine, and the Supabase-backed merchant-auth
 * helper are mocked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

const MERCHANT_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const MERCHANT_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"

const mocks = vi.hoisted(() => {
  const state = {
    terminals: { data: null, error: null } as { data: unknown; error: unknown },
    wallets: { data: null, error: null } as { data: unknown; error: unknown },
  }

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
    requireMerchantIdFromRequest: vi.fn(),
    state,
    db,
  }
})

vi.mock("@/database", () => ({ supabaseAdmin: mocks.db, supabase: mocks.db }))
vi.mock("@/engine/cashDrawer", () => ({ getDrawerState: mocks.getDrawerState }))
vi.mock("@/engine/posPayments", () => ({ previewPosBreakdownEngine: mocks.previewPosBreakdownEngine }))
vi.mock("@/engine/posTerminals", () => ({ resetPosTerminalPinWithRecoveryEngine: vi.fn() }))

// Keep the real signer/verifier so issued tokens are genuine credentials whose
// claims can be checked, but route signing through a spy so we can prove which
// paths mint and which do not.
vi.mock("@/lib/api/terminalAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/terminalAuth")>()
  mocks.signTerminalSession.mockImplementation(actual.signTerminalSession)
  return { ...actual, signTerminalSession: mocks.signTerminalSession }
})

// Stand in for the Supabase-backed merchant session. Mirrors the real contract:
// a bearer token resolves to a merchant id, and its absence throws 401.
vi.mock("@/lib/api/merchantAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/merchantAuth")>()
  return { ...actual, requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest }
})

import { NextRequest } from "next/server"
import { GET as terminalLaunchGET } from "@/app/api/pos/terminal-session/route"
import { POST as terminalExitPOST } from "@/app/api/pos/terminal-exit-auth/route"
import { POST as retiredTerminalAuthPOST } from "@/app/api/pos/terminal-auth/route"
import { GET as breakdownGET } from "@/app/api/pos/breakdown/route"
import { signTerminalSession, verifyTerminalSession } from "@/lib/api/terminalAuth"

const MERCHANT_SESSION_PREFIX = "merchant-jwt:"

function terminalRow(id: string, merchantId = MERCHANT_A, pin = "4321") {
  return {
    data: {
      id,
      name: "Front Register",
      autolock: "5",
      pin,
      merchant_id: merchantId,
      drawer_starting_amount: 200,
      tax_mode: "none",
      tax_rate: null,
      tax_label: "Sales tax",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    error: null,
  }
}

/** Launch request. Omit `asMerchant` to simulate an unauthenticated caller. */
function launchRequest(tid: string | null, asMerchant?: string) {
  const url = tid === null
    ? "http://localhost/api/pos/terminal-session"
    : `http://localhost/api/pos/terminal-session?tid=${encodeURIComponent(tid)}`
  return new NextRequest(url, {
    method: "GET",
    headers: asMerchant ? { authorization: `Bearer ${MERCHANT_SESSION_PREFIX}${asMerchant}` } : {},
  })
}

function exitRequest(pin: unknown, terminalToken?: string) {
  return new NextRequest("http://localhost/api/pos/terminal-exit-auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(terminalToken ? { authorization: `Bearer ${terminalToken}` } : {}),
    },
    body: JSON.stringify({ pin }),
  })
}

beforeAll(() => {
  process.env.TERMINAL_SESSION_SECRET = "ra1-terminal-contract-secret"
})

beforeEach(() => {
  mocks.signTerminalSession.mockClear()
  mocks.getDrawerState.mockReset()
  mocks.previewPosBreakdownEngine.mockReset()
  mocks.requireMerchantIdFromRequest.mockReset()
  mocks.requireMerchantIdFromRequest.mockImplementation(async (req: NextRequest) => {
    const header = req.headers.get("authorization") || ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : ""
    if (!token.startsWith(MERCHANT_SESSION_PREFIX)) {
      throw Object.assign(new Error("Missing bearer token"), { status: 401 })
    }
    return token.slice(MERCHANT_SESSION_PREFIX.length)
  })
  mocks.getDrawerState.mockResolvedValue({
    balance: 512.5,
    active: true,
    lastEntry: { type: "closeout", created_at: "2026-02-01T00:00:00.000Z" },
  })
  mocks.state.terminals = { data: null, error: null }
  mocks.state.wallets = { data: { network: "base" }, error: null }
})

/* ── Terminal id alone mints nothing (RA-1 stays closed) ─────────────────── */

describe("terminal id possession alone cannot mint a credential", () => {
  it("rejects an unauthenticated launch and returns no token", async () => {
    mocks.state.terminals = terminalRow("t-unauth")

    const res = await terminalLaunchGET(launchRequest("t-unauth"))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBe(401)
    expect(raw).not.toContain("pts_")
    expect(raw).not.toMatch(/sessionToken/i)
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("never reaches the database or the signer without a merchant session", async () => {
    mocks.state.terminals = terminalRow("t-unauth-2")

    await terminalLaunchGET(launchRequest("t-unauth-2"))

    // Auth is checked before the terminal is looked up.
    expect(mocks.getDrawerState).not.toHaveBeenCalled()
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("keeps the retired PIN-login route gone for every method", async () => {
    const res = await retiredTerminalAuthPOST()
    const body = await res.json()

    expect(res.status).toBe(410)
    expect(JSON.stringify(body)).not.toContain("pts_")
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })
})

/* ── Authenticated owner launch opens the POS with no PIN ────────────────── */

describe("authenticated merchant launch", () => {
  it("opens the merchant's own terminal and returns a pts_ credential", async () => {
    mocks.state.terminals = terminalRow("t-launch", MERCHANT_A)

    const res = await terminalLaunchGET(launchRequest("t-launch", MERCHANT_A))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(String(body.sessionToken)).toMatch(/^pts_/)
    expect(body.merchantId).toBe(MERCHANT_A)
    expect(body.terminal).toMatchObject({ id: "t-launch", name: "Front Register" })
    expect(mocks.signTerminalSession).toHaveBeenCalledTimes(1)
  })

  it("requires no PIN anywhere in the launch exchange", async () => {
    mocks.state.terminals = terminalRow("t-launch-nopin", MERCHANT_A, "4321")

    const res = await terminalLaunchGET(launchRequest("t-launch-nopin", MERCHANT_A))
    const raw = JSON.stringify(await res.json())

    // The launch request carried no PIN and the response leaks none.
    expect(raw).not.toContain("4321")
    expect(raw).not.toMatch(/"pin"/i)
    expect(raw).not.toMatch(/recoveryPhrase/i)
  })

  it("scopes the token to the verified merchant and terminal", async () => {
    mocks.state.terminals = terminalRow("t-claims", MERCHANT_A)

    const res = await terminalLaunchGET(launchRequest("t-claims", MERCHANT_A))
    const body = await res.json()
    const claims = verifyTerminalSession(String(body.sessionToken))

    expect(claims.mid).toBe(MERCHANT_A)
    expect(claims.tid).toBe("t-claims")
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it("marks credential responses private and no-store", async () => {
    mocks.state.terminals = terminalRow("t-cache", MERCHANT_A)

    const res = await terminalLaunchGET(launchRequest("t-cache", MERCHANT_A))

    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("cache-control")).toContain("private")
  })

  it("restores the POS on refresh through the same launch flow", async () => {
    mocks.state.terminals = terminalRow("t-refresh", MERCHANT_A)

    const first = await terminalLaunchGET(launchRequest("t-refresh", MERCHANT_A))
    const second = await terminalLaunchGET(launchRequest("t-refresh", MERCHANT_A))
    const a = await first.json()
    const b = await second.json()

    // A reload re-launches and gets a working credential again — no PIN, no
    // manual unlock step.
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(verifyTerminalSession(String(a.sessionToken)).tid).toBe("t-refresh")
    expect(verifyTerminalSession(String(b.sessionToken)).tid).toBe("t-refresh")
  })

  it("rejects a missing terminal id without signing", async () => {
    const res = await terminalLaunchGET(launchRequest(null, MERCHANT_A))

    expect(res.status).toBe(400)
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("produces no token for an unknown terminal", async () => {
    mocks.state.terminals = { data: null, error: { message: "no rows" } }

    const res = await terminalLaunchGET(launchRequest("t-missing", MERCHANT_A))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBe(404)
    expect(raw).not.toContain("pts_")
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })
})

/* ── Ownership is enforced server-side ───────────────────────────────────── */

describe("terminal ownership", () => {
  it("refuses to launch another merchant's terminal", async () => {
    mocks.state.terminals = terminalRow("t-owned-by-b", MERCHANT_B)

    const res = await terminalLaunchGET(launchRequest("t-owned-by-b", MERCHANT_A))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBe(404)
    expect(raw).not.toContain("pts_")
    expect(raw).not.toContain(MERCHANT_B)
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("checks ownership before signing, not after", async () => {
    mocks.state.terminals = terminalRow("t-order", MERCHANT_B)

    await terminalLaunchGET(launchRequest("t-order", MERCHANT_A))

    // Nothing was minted, so no token can leak through an error path.
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("ignores a merchant id supplied in the query string", async () => {
    mocks.state.terminals = terminalRow("t-query-spoof", MERCHANT_B)

    const req = new NextRequest(
      `http://localhost/api/pos/terminal-session?tid=t-query-spoof&merchantId=${MERCHANT_B}&merchant_id=${MERCHANT_B}`,
      { method: "GET", headers: { authorization: `Bearer ${MERCHANT_SESSION_PREFIX}${MERCHANT_A}` } }
    )
    const res = await terminalLaunchGET(req)

    // Merchant A is still merchant A; the query parameters are not consulted.
    expect(res.status).toBe(404)
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("lets each merchant launch only their own terminal", async () => {
    mocks.state.terminals = terminalRow("t-shared-id", MERCHANT_B)
    const asA = await terminalLaunchGET(launchRequest("t-shared-id", MERCHANT_A))
    expect(asA.status).toBe(404)

    const asB = await terminalLaunchGET(launchRequest("t-shared-id", MERCHANT_B))
    const body = await asB.json()
    expect(asB.status).toBe(200)
    expect(verifyTerminalSession(String(body.sessionToken)).mid).toBe(MERCHANT_B)
  })
})

/* ── The launched credential works on protected POS routes ───────────────── */

describe("protected POS routes accept the launched credential", () => {
  it("rejects a protected request with no terminal token", async () => {
    const res = await breakdownGET(
      new NextRequest("http://localhost/api/pos/breakdown?amount=25", { method: "GET" })
    )

    expect(res.status).toBe(401)
    expect(mocks.previewPosBreakdownEngine).not.toHaveBeenCalled()
  })

  it("accepts the token issued by an authenticated launch", async () => {
    mocks.state.terminals = terminalRow("t-protected", MERCHANT_A)
    mocks.previewPosBreakdownEngine.mockResolvedValue({ total: 25, tax: 0 })

    const launch = await terminalLaunchGET(launchRequest("t-protected", MERCHANT_A))
    const { sessionToken } = await launch.json()

    const res = await breakdownGET(
      new NextRequest("http://localhost/api/pos/breakdown?amount=25", {
        method: "GET",
        headers: { authorization: `Bearer ${sessionToken}` },
      })
    )

    expect(res.status).toBe(200)
    expect(mocks.previewPosBreakdownEngine).toHaveBeenCalledWith(MERCHANT_A, "t-protected", 25)
  })

  it("does not accept the merchant session JWT in place of a terminal token", async () => {
    const res = await breakdownGET(
      new NextRequest("http://localhost/api/pos/breakdown?amount=25", {
        method: "GET",
        headers: { authorization: `Bearer ${MERCHANT_SESSION_PREFIX}${MERCHANT_A}` },
      })
    )

    expect(res.status).toBe(401)
    expect(mocks.previewPosBreakdownEngine).not.toHaveBeenCalled()
  })
})

/* ── The PIN is the exit gate ────────────────────────────────────────────── */

describe("POST /api/pos/terminal-exit-auth authorizes leaving only", () => {
  /**
   * Mints the session the cashier is already holding. The signer is spied, so the
   * counter is cleared afterwards — otherwise the test's own setup would look
   * like the route minting a credential.
   */
  const activeToken = () => {
    const token = signTerminalSession(MERCHANT_A, "t-exit")
    mocks.signTerminalSession.mockClear()
    return token
  }

  beforeEach(() => {
    mocks.state.terminals = terminalRow("t-exit", MERCHANT_A, "4321")
  })

  it("authorizes exit for the correct PIN without issuing a replacement token", async () => {
    const res = await terminalExitPOST(exitRequest("4321", activeToken()))
    const body = await res.json()
    const raw = JSON.stringify(body)

    expect(res.status).toBe(200)
    expect(body.exitAuthorized).toBe(true)
    // The whole point: exiting must not hand back a fresh credential.
    expect(raw).not.toContain("pts_")
    expect(raw).not.toMatch(/sessionToken/i)
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("rejects an incorrect PIN so the cashier stays in the terminal", async () => {
    const res = await terminalExitPOST(exitRequest("0000", activeToken()))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBe(401)
    expect(raw).not.toContain("exitAuthorized")
    expect(mocks.signTerminalSession).not.toHaveBeenCalled()
  })

  it("rejects a malformed PIN", async () => {
    // A JSON number that stringifies to the same four digits is deliberately
    // absent: `String(4321)` is the identical PIN, so accepting it is correct.
    for (const pin of ["", "12", "12345", "abcd", "12a4", " 1 2 ", 12345, null, {}, []]) {
      const res = await terminalExitPOST(exitRequest(pin, activeToken()))
      const raw = JSON.stringify(await res.json())
      expect(res.status, `pin ${JSON.stringify(pin)}`).toBe(400)
      expect(raw).not.toContain("exitAuthorized")
    }
  })

  it("requires an active terminal session, so a PIN cannot be tested against an arbitrary terminal id", async () => {
    const withoutToken = await terminalExitPOST(exitRequest("4321"))
    expect(withoutToken.status).toBe(401)

    const forged = await terminalExitPOST(exitRequest("4321", "pts_forged.signature"))
    expect(forged.status).toBe(401)
  })

  it("takes the terminal identity from the signed claims, not the body", async () => {
    // A body-supplied terminalId is simply not part of the contract.
    const req = new NextRequest("http://localhost/api/pos/terminal-exit-auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${signTerminalSession(MERCHANT_A, "t-exit")}`,
      },
      body: JSON.stringify({ pin: "4321", terminalId: "t-somebody-elses", merchantId: MERCHANT_B }),
    })

    const res = await terminalExitPOST(req)
    expect(res.status).toBe(200)
    // Resolved against t-exit (from the claims), which is the row we staged.
    expect((await res.json()).exitAuthorized).toBe(true)
  })

  it("keeps exit attempts rate-limited", async () => {
    const tid = "t-exit-ratelimited"
    mocks.state.terminals = terminalRow(tid, MERCHANT_A, "4321")
    const token = signTerminalSession(MERCHANT_A, tid)
    mocks.signTerminalSession.mockClear()

    const statuses: number[] = []
    for (let attempt = 0; attempt < 7; attempt++) {
      const res = await terminalExitPOST(exitRequest("0000", token))
      statuses.push(res.status)
    }

    expect(statuses.filter((s) => s === 401).length).toBe(5)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)

    const blocked = await terminalExitPOST(exitRequest("4321", token))
    expect(blocked.status).toBe(429)
    expect(JSON.stringify(await blocked.json())).not.toContain("exitAuthorized")
  })

  it("marks exit responses private and no-store", async () => {
    const res = await terminalExitPOST(exitRequest("4321", activeToken()))
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("cache-control")).toContain("private")
  })
})

/* ── Client contract: POS opens on launch, PIN only on exit ──────────────── */

describe("terminal client opens the POS without a PIN and gates only exit", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/(pos)/terminal/TerminalInnerr.tsx"),
    "utf8"
  )

  it("sends the merchant session on launch and never falls back to a public request", () => {
    expect(source).toContain("supabase.auth.getSession()")
    expect(source).toContain("Authorization: `Bearer ${accessToken}`")
    // A missing merchant session is an error state, not a public retry.
    expect(source).toContain("setLaunchError")
    expect(source).not.toMatch(/fetch\(`\/api\/pos\/terminal-session\?tid=[^`]*`,\s*\{\s*cache: "no-store"\s*\}\)/)
  })

  it("establishes the terminal session from the launch response", () => {
    const launchIndex = source.indexOf("/api/pos/terminal-session?tid=")
    const contextIndex = source.indexOf("setTerminalContext({")
    expect(launchIndex).toBeGreaterThan(-1)
    expect(contextIndex).toBeGreaterThan(launchIndex)
    expect(source).toContain("sessionToken: String(payload.sessionToken)")
  })

  it("does not gate the POS behind PIN entry", () => {
    // The entry-gate expression from the earlier, incorrect fix must not return.
    expect(source).not.toContain("needsPin")
    expect(source).not.toMatch(/unlockMode\s*\|\|\s*!hasTerminalSession/)
    // The PIN pad is shown only by the exit control.
    expect(source).toContain("{unlockMode && (")
    expect(source).toContain("{!unlockMode && (shiftStarted")
  })

  it("shows the PIN dialog only from the exit control", () => {
    expect(source).toContain("function requestUnlock(){")
    expect(source).toContain("setUnlockMode(true)")
    expect(source).toContain("onClick={requestUnlock}")
    // Nothing sets unlockMode true during launch.
    const launchBlock = source.slice(
      source.indexOf("async function launchTerminal"),
      source.indexOf("launchTerminal()")
    )
    expect(launchBlock).not.toContain("setUnlockMode(true)")
  })

  it("verifies the exit PIN server-side with the active terminal session", () => {
    expect(source).toContain("/api/pos/terminal-exit-auth")
    expect(source).toContain("Authorization: `Bearer ${activeToken}`")
    expect(source).not.toContain("/api/pos/terminal-auth")
  })

  it("keeps the credential when the exit PIN is wrong and clears it only on success", () => {
    const handler = source.slice(
      source.indexOf("async function handleDigitsChange"),
      source.indexOf("function requestUnlock")
    )
    const failureIndex = handler.indexOf("if (!res.ok)")
    const clearIndex = handler.indexOf("setTerminalContext(null)")
    const navigateIndex = handler.indexOf('router.push("/dashboard/pos")')

    expect(failureIndex).toBeGreaterThan(-1)
    expect(clearIndex).toBeGreaterThan(failureIndex)
    expect(navigateIndex).toBeGreaterThan(clearIndex)
    // The failure branch returns before reaching the clear/navigate code.
    expect(handler.slice(failureIndex, clearIndex)).toContain("return")
  })

  it("renders the POS once the launch succeeds and hides it while exiting", () => {
    expect(source).toContain("<POSLayout")
    expect(source).toMatch(/\{!unlockMode && \(shiftStarted \|\| Number\(terminal\.drawer_starting_amount \?\? 0\) === 0\) && \(\s*<POSLayout/)
    expect(source).toContain("if (!terminal || !hasTerminalSession) {")
    expect(source).toContain("Loading terminal...")
  })
})

/* ── Blast radius ────────────────────────────────────────────────────────── */

describe("terminal launch and exit touch no payment or provider execution", () => {
  const files = [
    "app/api/pos/terminal-session/route.ts",
    "app/api/pos/terminal-exit-auth/route.ts",
    "app/api/pos/terminal-auth/route.ts",
    "engine/posTerminalSession.ts",
  ]

  it("imports no Stripe, Shift4, provider, or payment-execution module", () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8")
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1])
      for (const specifier of imports) {
        expect(specifier, `${file} must not reach provider or payment execution`).not.toMatch(
          /providers?\/|stripe|shift4|paymentDetect|eventProcessor|ledger/i
        )
      }
    }
  })

  it("keeps exactly one signing site in the terminal engine", () => {
    const engine = fs.readFileSync(path.join(process.cwd(), "engine/posTerminalSession.ts"), "utf8")
    const calls = [...engine.matchAll(/signTerminalSession\(/g)]
    // One import reference plus one call site.
    expect(calls.length).toBe(1)
    // And it lives in the ownership-checked launch function.
    const launch = engine.slice(
      engine.indexOf("export async function launchPosTerminalEngine"),
      engine.indexOf("export async function verifyPosTerminalExitPinEngine")
    )
    expect(launch).toContain("signTerminalSession(")
    expect(launch).toContain('String(terminal.merchant_id) !== merchantId')
  })

  it("never mints a credential in the exit path", () => {
    const engine = fs.readFileSync(path.join(process.cwd(), "engine/posTerminalSession.ts"), "utf8")
    const exit = engine.slice(engine.indexOf("export async function verifyPosTerminalExitPinEngine"))
    expect(exit).not.toContain("signTerminalSession(")
  })
})
