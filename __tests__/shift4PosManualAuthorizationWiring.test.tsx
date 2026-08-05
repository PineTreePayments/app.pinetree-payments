/**
 * Shift4 Manual Authorization — POS wiring.
 *
 * The Engine's request builders and lineage rules are covered by
 * `shift4ManualAuthorization.test.ts`. This file covers the POS side, and
 * prefers executing the code to reading it:
 *
 *   - the referral decision runs as a pure function over attempt lineage;
 *   - both route handlers are invoked for real with the store mocked;
 *   - the clerk's screens are rendered and asserted on their actual markup;
 *   - the blocked-versus-approved rule is executed, not regex-matched.
 *
 * Source-contract assertions are kept only where they guard a security
 * boundary that cannot be executed without a DOM, and are grouped at the end so
 * it is obvious which is which.
 *
 * NO SHIFT4 REQUEST IS MADE. A global guard fails the suite if any fetch is
 * aimed at a Shift4 host, and every feature gate stays closed throughout.
 */

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import PosCardPaymentExperience, {
  type PosCardView,
} from "@/components/pos/PosCardPaymentExperience"
import { resolveManualAuthorizationOutcome } from "@/components/pos/Shift4ManualAuthorizationPanel"
import { TransactionResult } from "@/components/payment/TransactionResult"
import {
  classifyShift4ReferralState,
  type Shift4ReferralLineageRow,
} from "@/engine/shift4/referralState"

const mocks = vi.hoisted(() => ({
  requireTerminalSession: vi.fn(),
  listShift4PaymentAttempts: vi.fn(),
  readShift4FeatureFlags: vi.fn(),
}))

vi.mock("@/lib/api/terminalAuth", () => ({
  requireTerminalSession: mocks.requireTerminalSession,
}))

vi.mock("@/database/shift4PaymentAttempts", () => ({
  listShift4PaymentAttempts: mocks.listShift4PaymentAttempts,
}))

vi.mock("@/engine/shift4/readiness", () => ({
  readShift4FeatureFlags: mocks.readShift4FeatureFlags,
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  getRouteErrorStatus: () => 500,
}))

import { NextRequest } from "next/server"

import { GET as referralStatusGET } from "@/app/api/pos/shift4-referral-status/route"
import { POST as manualAuthorizationPOST } from "@/app/api/pos/shift4-manual-authorization/route"

const PAYMENT_ID = "3f1c9a2e-8b7d-4e5f-9a1b-2c3d4e5f6a7b"
const MERCHANT_ID = "merchant-a"
const SESSION = "pts_terminal_session"

const read = (path: string) => readFileSync(path, "utf8")
/** Strip comments and JSX comments so a "must not contain" tests the CODE. */
const codeOnly = (text: string) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")

const panelCode = codeOnly(read("components/pos/Shift4ManualAuthorizationPanel.tsx"))
const layoutCode = codeOnly(read("components/pos/POSLayout.tsx"))
const referralRouteCode = codeOnly(read("app/api/pos/shift4-referral-status/route.ts"))

/* -- lineage fixtures ------------------------------------------------------ */

let clock = 0
/** Rows are built in call order, so "later" always means later. */
const row = (
  overrides: Partial<Shift4ReferralLineageRow> = {}
): Shift4ReferralLineageRow => {
  clock += 1
  return {
    channel: "retail",
    attempt_role: "authorization",
    response_code: null,
    state: "created",
    created_at: `2026-08-05T00:00:${String(clock).padStart(2, "0")}.000Z`,
    id: `attempt-${clock}`,
    ...overrides,
  }
}

const referral = (overrides: Partial<Shift4ReferralLineageRow> = {}) =>
  row({ attempt_role: "referral_authorization", response_code: "R", state: "action_required", ...overrides })

const approved = (role: string) => row({ attempt_role: role, response_code: "A", state: "approved" })

/* -- request builders ------------------------------------------------------ */

const referralRequest = (paymentId = PAYMENT_ID) =>
  new NextRequest(
    `https://app.pinetree-payments.test/api/pos/shift4-referral-status?paymentId=${encodeURIComponent(paymentId)}`,
    { headers: { authorization: `Bearer ${SESSION}` } }
  )

const manualRequest = (body: unknown) =>
  new NextRequest("https://app.pinetree-payments.test/api/pos/shift4-manual-authorization", {
    method: "POST",
    headers: { authorization: `Bearer ${SESSION}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

async function referralStatusFor(rows: Shift4ReferralLineageRow[]) {
  mocks.listShift4PaymentAttempts.mockResolvedValue(rows)
  const response = await referralStatusGET(referralRequest())
  const body = (await response.json()) as {
    shift4Retail?: boolean
    referralRequired?: boolean
  }
  return { status: response.status, body }
}

/* -- render helpers -------------------------------------------------------- */

const EXPERIENCE_PROPS = {
  amount: "$10.00",
  capabilities: null,
  selectedReaderId: "",
  loading: false,
  error: "",
  paymentLink: "",
  paymentId: PAYMENT_ID,
  manualClientSecret: "",
  manualStripeAccountId: "",
  manualReturnUrl: "",
  onSelectReader: () => {},
  onSendToReader: () => {},
  onRefreshReaders: () => {},
  onOpenSetup: () => {},
  onCreateLocation: async () => {},
  onCreateSandboxReader: () => {},
  onOpenRegister: () => {},
  onRegisterReader: async () => {},
  onOpenManual: () => {},
  onManualSuccess: () => {},
  onManualError: () => {},
  onSendPaymentLink: () => {},
  onTryAgain: () => {},
  onBack: () => {},
  onCancel: () => {},
  onDone: () => {},
  onViewReceipt: () => {},
} as const

const renderExperience = (view: PosCardView, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(PosCardPaymentExperience, {
      ...EXPERIENCE_PROPS,
      view,
      sessionToken: SESSION,
      onShift4ReferralCancel: () => {},
      ...extra,
    } as never)
  )

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  clock = 0
  mocks.requireTerminalSession.mockReset()
  mocks.requireTerminalSession.mockReturnValue({ mid: MERCHANT_ID, tid: "terminal-1", exp: 0 })
  mocks.listShift4PaymentAttempts.mockReset()
  mocks.listShift4PaymentAttempts.mockResolvedValue([])
  mocks.readShift4FeatureFlags.mockReset()
  // Every gate closed — the state this work must preserve.
  mocks.readShift4FeatureFlags.mockReturnValue({
    restApi: false,
    retail: false,
    certificationMode: false,
    commerceEngineConfigured: false,
    production: false,
    manualAuthorization: false,
  })

  fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", fetchSpy)
})

afterEach(() => {
  for (const call of fetchSpy.mock.calls) {
    expect(String(call[0])).not.toMatch(/shift4|i4go|4go\.co/i)
  }
  vi.unstubAllGlobals()
})

/* ========================================================================== */

describe("referral classification (pure, executed over attempt lineage)", () => {
  it("reports no Shift4 Retail lineage for a payment with no attempts", () => {
    // A Stripe, FluidPay or crypto sale. This is what stops the POS asking again.
    expect(classifyShift4ReferralState([])).toEqual({
      shift4Retail: false,
      referralRequired: false,
    })
  })

  it("requires a referral for an open retail referral attempt", () => {
    expect(classifyShift4ReferralState([referral()])).toEqual({
      shift4Retail: true,
      referralRequired: true,
    })
  })

  it("accepts the documented responseCode R under any role", () => {
    const byCode = classifyShift4ReferralState([
      row({ attempt_role: "authorization", response_code: "R", state: "action_required" }),
    ])
    expect(byCode.referralRequired).toBe(true)
  })

  it("does not require a referral for ordinary outcomes", () => {
    const cases: Array<[string, Shift4ReferralLineageRow]> = [
      ["approval", row({ attempt_role: "sale", response_code: "A", state: "approved" })],
      ["decline", row({ response_code: "D", state: "declined" })],
      ["generic failure", row({ state: "declined" })],
      ["incomplete", row({ state: "created" })],
      ["timeout", row({ state: "unresolved" })],
      ["communication error", row({ state: "reconciliation_required" })],
      ["unknown outcome", row({ response_code: "", state: "unresolved" })],
      ["canceled", row({ state: "abandoned" })],
    ]
    for (const [label, attempt] of cases) {
      expect(classifyShift4ReferralState([attempt]).referralRequired, label).toBe(false)
    }
  })

  it("ignores an E-commerce referral entirely", () => {
    // Not a clerk's job, and it must not even mark the sale as retail.
    expect(classifyShift4ReferralState([referral({ channel: "ecommerce" })])).toEqual({
      shift4Retail: false,
      referralRequired: false,
    })
  })

  it("closes once the referral attempt itself settles", () => {
    for (const state of ["approved", "declined", "abandoned"]) {
      expect(classifyShift4ReferralState([referral({ state })]).referralRequired, state).toBe(false)
    }
  })

  it("closes after a later approved manual authorization, capture or void", () => {
    for (const role of ["manual_authorization", "capture", "void"]) {
      clock = 0
      const rows = [referral(), approved(role)]
      expect(classifyShift4ReferralState(rows).referralRequired, role).toBe(false)
    }
  })

  it("stays open after a DECLINED manual authorization so a wrong code can be retried", () => {
    const rows = [referral(), row({ attempt_role: "manual_authorization", state: "declined" })]
    expect(classifyShift4ReferralState(rows).referralRequired).toBe(true)
  })

  it("re-opens for a NEW referral that follows a resolved one", () => {
    // Order is the whole point: a set-based check would wrongly stay closed here.
    const rows = [referral(), approved("manual_authorization"), referral()]
    expect(classifyShift4ReferralState(rows).referralRequired).toBe(true)
  })

  it("is order-independent in its input", () => {
    const first = referral()
    const later = approved("capture")
    // Same lineage, shuffled: the capture still resolves the earlier referral.
    expect(classifyShift4ReferralState([later, first]).referralRequired).toBe(false)
  })
})

/* ========================================================================== */

describe("referral-status route (executed handler)", () => {
  it("returns the classification for a real referral", async () => {
    const { status, body } = await referralStatusFor([referral()])
    expect(status).toBe(200)
    expect(body).toEqual({ paymentId: PAYMENT_ID, shift4Retail: true, referralRequired: true })
  })

  it("tells the POS to stop asking for a non-Shift4 sale", async () => {
    const { body } = await referralStatusFor([])
    expect(body.shift4Retail).toBe(false)
    expect(body.referralRequired).toBe(false)
  })

  it("derives merchant identity from the signed session only", async () => {
    await referralStatusFor([referral()])
    expect(mocks.requireTerminalSession).toHaveBeenCalledOnce()
    expect(mocks.listShift4PaymentAttempts).toHaveBeenCalledWith(MERCHANT_ID, PAYMENT_ID)
  })

  it("rejects another merchant's payment generically", async () => {
    // The merchant-scoped read returns nothing, which is indistinguishable from
    // a payment that does not exist.
    const { status, body } = await referralStatusFor([])
    expect(status).toBe(200)
    expect(body.referralRequired).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/merchant|attempt|invoice|amount/i)
  })

  it("rejects a caller with no terminal session", async () => {
    mocks.requireTerminalSession.mockImplementation(() => {
      throw new Error("Missing terminal session token")
    })
    const response = await referralStatusGET(referralRequest())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Unable to check the Shift4 referral status" })
    expect(mocks.listShift4PaymentAttempts).not.toHaveBeenCalled()
  })

  it("rejects a malformed payment reference before reading anything", async () => {
    const response = await referralStatusGET(referralRequest("not-a-uuid"))
    expect(response.status).toBe(400)
    expect(mocks.listShift4PaymentAttempts).not.toHaveBeenCalled()
  })

  it("returns only a payment reference and two booleans, uncached", async () => {
    mocks.listShift4PaymentAttempts.mockResolvedValue([referral()])
    const response = await referralStatusGET(referralRequest())
    const body = (await response.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["paymentId", "referralRequired", "shift4Retail"])
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })
})

/* ========================================================================== */

describe("submission route (executed handler, every gate closed)", () => {
  it("validates a code without dispatching, and never echoes it", async () => {
    const response = await manualAuthorizationPOST(
      manualRequest({ paymentId: PAYMENT_ID, authorizationCode: "ab12cd" })
    )
    const body = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(body.dispatchPermitted).toBe(false)
    expect(body.providerCallPerformed).toBe(false)
    expect(body.authorizationCodeAccepted).toBe(true)
    expect(body.blockedReason).toBeTruthy()
    expect(JSON.stringify(body)).not.toMatch(/AB12CD/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("refuses any field beyond paymentId and authorizationCode", async () => {
    for (const extra of [
      { merchantId: "merchant-b" },
      { invoice: "0510093358" },
      { amount: 100 },
      { cardToken: "8048471746471119" },
      { serialNumber: "1170301234" },
      { responseCode: "R" },
      { purchaseCard: {} },
      { somethingElse: true },
    ]) {
      const response = await manualAuthorizationPOST(
        manualRequest({ paymentId: PAYMENT_ID, authorizationCode: "AB12CD", ...extra })
      )
      expect(response.status, JSON.stringify(extra)).toBe(403)
    }
  })

  it("rejects a code that is not exactly six alphanumeric characters", async () => {
    for (const bad of ["AB12C", "AB12CD7", "AB 12C", "AB-12C", "", "      "]) {
      const response = await manualAuthorizationPOST(
        manualRequest({ paymentId: PAYMENT_ID, authorizationCode: bad })
      )
      expect(response.status, JSON.stringify(bad)).toBe(400)
    }
  })
})

/* ========================================================================== */

describe("blocked is not success (executed rule)", () => {
  it("treats a 200 with dispatchPermitted false as BLOCKED", () => {
    const outcome = resolveManualAuthorizationOutcome({
      dispatchPermitted: false,
      blockedReason: "Awaiting Retail test enablement",
    })
    expect(outcome.kind).toBe("blocked")
  })

  it("fails closed when the server says nothing about dispatch", () => {
    // A bare HTTP 200 must never be read as an authorization.
    expect(resolveManualAuthorizationOutcome({}).kind).toBe("blocked")
    expect(resolveManualAuthorizationOutcome(null).kind).toBe("blocked")
  })

  it("reports acceptance only on an explicit dispatchPermitted true", () => {
    expect(resolveManualAuthorizationOutcome({ dispatchPermitted: true }).kind).toBe("accepted")
  })

  it("tells the clerk the code was not sent, and does not claim approval", () => {
    const markup = renderExperience("shift4-referral")
    // The panel starts with no outcome; the blocked copy itself must be honest.
    const panelSource = read("components/pos/Shift4ManualAuthorizationPanel.tsx")
    expect(panelSource).toMatch(/not sent to Shift4/i)
    expect(panelSource).toMatch(/still unauthorized/i)
    expect(panelSource).not.toMatch(/authorization approved|payment authorized|capture may proceed/i)
    expect(markup).toContain("Submit Manual Authorization")
  })
})

/* ========================================================================== */

describe("clerk screens (rendered)", () => {
  it("renders the real panel through the POS card experience", () => {
    const markup = renderExperience("shift4-referral")
    expect(markup).toContain("Submit Manual Authorization")
    expect(markup).toMatch(/six-character/i)
    expect(markup).toMatch(/chargeback/i)
    expect(markup).toContain("Cancel")
  })

  it("does not render the panel on any other card view", () => {
    const otherViews: PosCardView[] = [
      "loading",
      "collect",
      "no-reader",
      "waiting",
      "processing",
      "approved",
      "declined",
      "payment-link",
    ]
    for (const view of otherViews) {
      expect(renderExperience(view), view).not.toContain("Submit Manual Authorization")
    }
  })

  it("offers a way back in after the clerk closes the panel", () => {
    // Closing the panel must not strand an unresolved referral.
    const markup = renderExperience("processing", { onReopenShift4Referral: () => {} })
    expect(markup).toContain("Review voice authorization")
  })

  it("shows no reopen action when no referral is outstanding", () => {
    const markup = renderExperience("processing")
    expect(markup).not.toContain("Review voice authorization")
  })
})

/* ========================================================================== */

describe("TransactionResult accepts the canonical pending state", () => {
  it("renders state=\"PENDING\" instead of throwing", () => {
    // Regression: the POS card rail renders its reader waiting screen as
    // state="PENDING", which previously threw "Invalid transaction result
    // state: pending" on every send-to-reader.
    expect(() =>
      renderToStaticMarkup(createElement(TransactionResult, { state: "PENDING", compact: true }))
    ).not.toThrow()
  })

  it("renders the POS reader waiting view", () => {
    expect(() => renderExperience("waiting")).not.toThrow()
  })

  it("still rejects a genuinely invalid state", () => {
    expect(() =>
      renderToStaticMarkup(createElement(TransactionResult, { state: "banana" }))
    ).toThrow(/Invalid transaction result state/i)
  })
})

/* ========================================================================== */

describe("POS lifecycle source contracts", () => {
  // These guard behaviour that needs a mounted terminal with timers to execute,
  // which this suite has no DOM for. They are contracts, not runtime proof.

  it("stops asking once the sale is known not to be Shift4 Retail", () => {
    expect(layoutCode).toContain("if (data?.shift4Retail !== true) {")
    expect(layoutCode).toContain("shift4ReferralNotApplicableRef.current = true")
    expect(layoutCode).toContain("if (shift4ReferralNotApplicableRef.current) return")
  })

  it("never overlaps referral requests", () => {
    expect(layoutCode).toContain("if (shift4ReferralInFlightRef.current) return")
    expect(layoutCode).toContain("shift4ReferralInFlightRef.current = true")
    expect(layoutCode).toContain("shift4ReferralInFlightRef.current = false")
  })

  it("aborts the outstanding request on cleanup and stops polling", () => {
    expect(layoutCode).toContain("const controller = new AbortController()")
    expect(layoutCode).toContain("signal: controller.signal")
    expect(layoutCode).toContain("controller.abort()")
  })

  it("discards an answer that belongs to a superseded sale", () => {
    expect(layoutCode).toContain("if (stopped || myGeneration !== saleGenerationRef.current) return")
  })

  it("stops polling once the referral is known", () => {
    expect(layoutCode).toContain("markShift4ReferralAvailable()")
    expect(layoutCode).toContain("if (shift4ReferralAvailableRef.current) return")
  })

  it("keeps the panel open across status ticks that still say processing", () => {
    expect(layoutCode).toContain(
      'if (next === "processing" && !shift4ReferralActiveRef.current) setCardView("processing")'
    )
  })

  it("lets a real terminal outcome close the panel and withdraw the reopen action", () => {
    expect(layoutCode).toContain("if (terminalOutcome) {")
    expect(layoutCode).toContain("shift4ReferralAvailableRef.current = false")
  })

  it("arms the auto-reset timer only for a terminal card result", () => {
    expect(layoutCode).toContain(
      'paymentMode === "card" && (cardView === "approved" || cardView === "declined")'
    )
    expect(layoutCode).not.toMatch(/cardView === "shift4-referral"[^\n]*resetSale/)
  })

  it("closing the panel resolves nothing and sends no provider request", () => {
    const start = layoutCode.indexOf("function closeShift4ReferralPanel()")
    const body = layoutCode.slice(start, layoutCode.indexOf("\n  }", start))
    expect(body).toContain('setCardView("processing")')
    expect(body).not.toContain("cancelSale")
    expect(body).not.toContain("fetch(")
    expect(body).not.toContain('setStatus("failed")')
    expect(body).not.toContain('setStatus("confirmed")')
  })

  it("a new sale clears every referral flag", () => {
    const reset = layoutCode.slice(
      layoutCode.indexOf("function resetSale()"),
      layoutCode.indexOf("async function cancelSale()")
    )
    for (const flag of [
      "shift4ReferralActiveRef.current = false",
      "shift4ReferralAvailableRef.current = false",
      "shift4ReferralNotApplicableRef.current = false",
      "shift4ReferralInFlightRef.current = false",
    ]) {
      expect(reset, flag).toContain(flag)
    }
  })
})

/* ========================================================================== */

describe("security boundaries (source contracts)", () => {
  it("sends nothing on mount — the panel has no effects", () => {
    renderExperience("shift4-referral")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(panelCode).not.toContain("useEffect")
  })

  it("guards double submission synchronously, before the first await", () => {
    const body = panelCode.slice(panelCode.indexOf("const submit ="))
    const guardRead = body.indexOf("if (inFlightRef.current) return")
    const guardSet = body.indexOf("inFlightRef.current = true")
    const firstAwait = body.indexOf("await")
    expect(guardRead).toBeGreaterThan(-1)
    expect(guardSet).toBeGreaterThan(guardRead)
    expect(firstAwait).toBeGreaterThan(guardSet)
  })

  it("sends exactly paymentId and authorizationCode", () => {
    const body = panelCode.match(/body:\s*JSON\.stringify\(\{([^}]*)\}\)/)
    expect(body).not.toBeNull()
    const keys = [...(body?.[1] ?? "").matchAll(/(\w+)\s*[:,]?/g)].map((m) => m[1])
    expect([...new Set(keys)].sort()).toEqual(["authorizationCode", "code", "paymentId"])
    for (const forbidden of ["invoice", "amountMinor", "merchantId", "cardToken", "serialNumber"]) {
      expect(panelCode).not.toContain(forbidden)
    }
  })

  it("requires six alphanumeric characters and uppercases them", () => {
    expect(panelCode).toContain("/^[A-Z0-9]{6}$/.test(code)")
    expect(panelCode).toContain('.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)')
  })

  it("clears the code after submission and after closing", () => {
    const submitBody = panelCode.slice(
      panelCode.indexOf("const submit ="),
      panelCode.indexOf("const cancel =")
    )
    const cancelBody = panelCode.slice(panelCode.indexOf("const cancel ="))
    expect(submitBody).toContain('setCode("")')
    expect(cancelBody).toContain('setCode("")')
    expect(cancelBody).not.toContain("fetch(")
  })

  it("never writes the code to the console", () => {
    expect(panelCode).not.toMatch(/console\.(log|warn|error|info|debug)/)
  })

  it("keeps the route a thin adapter with no lifecycle logic of its own", () => {
    expect(referralRouteCode).toContain("classifyShift4ReferralState")
    // The classification rules live in the Engine, not here.
    expect(referralRouteCode).not.toContain("referral_authorization")
    expect(referralRouteCode).not.toContain("manual_authorization")
    expect(referralRouteCode).not.toContain("request.json")
  })

  it("leaks no credential, token, device or provider evidence", () => {
    for (const forbidden of [
      "accessToken",
      "authToken",
      "clientGuid",
      "cardToken",
      "serialNumber",
      "manufacturer",
      "terminalId",
      "attemptId",
      "invoice",
      "amount",
    ]) {
      expect(referralRouteCode, forbidden).not.toContain(forbidden)
    }
  })
})
