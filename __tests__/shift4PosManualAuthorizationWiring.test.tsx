/**
 * Shift4 Manual Authorization — POS wiring.
 *
 * The Engine, the request builders, the lineage rules and the submission route
 * are covered by `shift4ManualAuthorization.test.ts`. These tests cover the one
 * thing that file cannot: whether a clerk standing at a real PineTree terminal
 * can actually REACH the panel, and whether it opens only from authoritative
 * referral evidence.
 *
 * The referral decision is executed for real against the route handler, with the
 * attempt store mocked, so every negative case (approval, decline, timeout,
 * capture, E-commerce, another merchant …) is proven by running the code rather
 * than by reading it.
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

const PANEL_PATH = "components/pos/Shift4ManualAuthorizationPanel.tsx"
const EXPERIENCE_PATH = "components/pos/PosCardPaymentExperience.tsx"
const LAYOUT_PATH = "components/pos/POSLayout.tsx"
const REFERRAL_ROUTE_PATH = "app/api/pos/shift4-referral-status/route.ts"

const read = (path: string) => readFileSync(path, "utf8")

/** Strip comments and JSX comments so "must not contain" tests the CODE. */
const codeOnly = (text: string) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")

const panelSource = read(PANEL_PATH)
const panelCode = codeOnly(panelSource)
const layoutSource = read(LAYOUT_PATH)
const layoutCode = codeOnly(layoutSource)
const experienceCode = codeOnly(read(EXPERIENCE_PATH))
const referralRouteCode = codeOnly(read(REFERRAL_ROUTE_PATH))

/** A stored attempt. Only the fields the referral decision actually reads. */
type AttemptShape = {
  channel: string
  attempt_role: string
  response_code: string | null
  state: string
}

const attempt = (overrides: Partial<AttemptShape> = {}): AttemptShape => ({
  channel: "retail",
  attempt_role: "referral_authorization",
  response_code: "R",
  state: "action_required",
  ...overrides,
})

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

/** Run the referral decision against a given set of stored attempts. */
async function referralRequiredFor(rows: AttemptShape[]): Promise<boolean> {
  mocks.listShift4PaymentAttempts.mockResolvedValue(rows)
  const response = await referralStatusGET(referralRequest())
  expect(response.status).toBe(200)
  const body = (await response.json()) as { referralRequired?: boolean }
  return body.referralRequired === true
}

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

const renderExperience = (view: PosCardView) =>
  renderToStaticMarkup(
    createElement(PosCardPaymentExperience, {
      ...EXPERIENCE_PROPS,
      view,
      sessionToken: SESSION,
      onShift4ReferralCancel: () => {},
    } as never)
  )

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  mocks.requireTerminalSession.mockReset()
  mocks.requireTerminalSession.mockReturnValue({ mid: MERCHANT_ID, tid: "terminal-1", exp: 0 })
  mocks.listShift4PaymentAttempts.mockReset()
  mocks.listShift4PaymentAttempts.mockResolvedValue([])
  mocks.readShift4FeatureFlags.mockReset()
  // Every gate closed — the state this task must preserve.
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
  // No provider request may leave this suite, ever.
  for (const call of fetchSpy.mock.calls) {
    expect(String(call[0])).not.toMatch(/shift4|i4go|4go\.co/i)
  }
  vi.unstubAllGlobals()
})

/* ========================================================================== */

describe("reachability — the panel is mounted in the real POS lifecycle", () => {
  it("is imported and rendered by PosCardPaymentExperience, not left standalone", () => {
    expect(experienceCode).toContain('import Shift4ManualAuthorizationPanel from "@/components/pos/Shift4ManualAuthorizationPanel"')
    expect(experienceCode).toContain("<Shift4ManualAuthorizationPanel")
    expect(experienceCode).toContain('props.view === "shift4-referral"')
  })

  it("renders the real panel through the POS card experience", () => {
    const markup = renderExperience("shift4-referral")
    expect(markup).toContain("Submit Manual Authorization")
    expect(markup).toMatch(/six-character/i)
    expect(markup).toMatch(/chargeback/i)
    expect(markup).toContain("Cancel")
  })

  it("is reached from POSLayout, which the live terminal route renders", () => {
    // POSLayout owns the card view, and only it can open the referral view.
    expect(layoutCode).toContain('setCardView("shift4-referral")')
    expect(layoutCode).toContain("onShift4ReferralCancel={dismissShift4Referral}")
    expect(layoutCode).toContain("sessionToken={terminalContext?.sessionToken}")
    // …and POSLayout is mounted by the real POS terminal route.
    expect(read("app/(pos)/terminal/TerminalInnerr.tsx")).toContain(
      'import POSLayout from "@/components/pos/POSLayout"'
    )
  })

  it("does not render the panel on any other card view", () => {
    // "waiting" is omitted deliberately: it renders TransactionResult with
    // state="PENDING", which that component rejects, so it throws before this
    // assertion could mean anything. That is a pre-existing defect on the card
    // reader's waiting screen, unrelated to manual authorization, and is left
    // untouched here rather than fixed silently inside this task.
    const otherViews: PosCardView[] = [
      "loading",
      "collect",
      "no-reader",
      "processing",
      "approved",
      "declined",
      "payment-link",
    ]
    for (const view of otherViews) {
      expect(renderExperience(view), view).not.toContain("Submit Manual Authorization")
    }
  })
})

/* ========================================================================== */

describe("referral condition — only authoritative Shift4 Retail evidence opens it", () => {
  it("opens for a persisted retail referral_authorization attempt", async () => {
    expect(await referralRequiredFor([attempt()])).toBe(true)
  })

  it("opens for the documented responseCode R even under another role", async () => {
    expect(
      await referralRequiredFor([attempt({ attempt_role: "authorization", response_code: "R" })])
    ).toBe(true)
  })

  it("stays closed for every non-referral outcome", async () => {
    const nonReferral: Array<[string, AttemptShape]> = [
      ["approval", attempt({ attempt_role: "sale", response_code: "A", state: "approved" })],
      ["decline", attempt({ attempt_role: "authorization", response_code: "D", state: "declined" })],
      ["generic failure", attempt({ attempt_role: "authorization", response_code: null, state: "declined" })],
      ["incomplete", attempt({ attempt_role: "authorization", response_code: null, state: "created" })],
      ["timeout", attempt({ attempt_role: "authorization", response_code: null, state: "unresolved" })],
      ["communication error", attempt({ attempt_role: "authorization", response_code: null, state: "reconciliation_required" })],
      ["unknown outcome", attempt({ attempt_role: "authorization", response_code: "", state: "unresolved" })],
      ["canceled", attempt({ attempt_role: "authorization", response_code: null, state: "abandoned" })],
    ]
    for (const [label, row] of nonReferral) {
      expect(await referralRequiredFor([row]), label).toBe(false)
    }
  })

  it("stays closed for a Shift4 E-commerce referral — that is not a clerk's job", async () => {
    expect(await referralRequiredFor([attempt({ channel: "ecommerce" })])).toBe(false)
  })

  it("stays closed once the referral itself has settled", async () => {
    for (const state of ["approved", "declined", "abandoned"]) {
      expect(await referralRequiredFor([attempt({ state })]), state).toBe(false)
    }
  })

  it("stays closed once the payment moved past the referral", async () => {
    for (const role of ["manual_authorization", "capture", "void"]) {
      const rows = [attempt(), attempt({ attempt_role: role, response_code: "A", state: "approved" })]
      expect(await referralRequiredFor(rows), role).toBe(false)
    }
  })

  it("stays closed when the payment has no Shift4 attempts at all", async () => {
    // A Stripe or crypto sale never reaches this table.
    expect(await referralRequiredFor([])).toBe(false)
  })

  it("never trusts a browser-supplied response code", () => {
    // The decision reads only stored rows and the session — never the request body.
    expect(referralRouteCode).not.toContain("request.json")
    expect(referralRouteCode).not.toMatch(/searchParams\.get\(\s*"(responseCode|referral|merchantId|channel)"/)
  })
})

/* ========================================================================== */

describe("tenancy and safe responses", () => {
  it("derives the merchant from the signed terminal session, never the request", async () => {
    await referralRequiredFor([attempt()])
    expect(mocks.requireTerminalSession).toHaveBeenCalledOnce()
    expect(mocks.listShift4PaymentAttempts).toHaveBeenCalledWith(MERCHANT_ID, PAYMENT_ID)
    expect(referralRouteCode).not.toContain("merchantId =")
  })

  it("rejects another merchant's payment generically", async () => {
    // A merchant-scoped read returns nothing, which is indistinguishable from
    // a payment that does not exist.
    mocks.listShift4PaymentAttempts.mockResolvedValue([])
    const response = await referralStatusGET(referralRequest())
    const body = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(body.referralRequired).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/merchant|attempt|invoice/i)
  })

  it("rejects a session-less caller", async () => {
    mocks.requireTerminalSession.mockImplementation(() => {
      throw new Error("Missing terminal session token")
    })
    const response = await referralStatusGET(referralRequest())
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error?: string }
    expect(body.error).toBe("Unable to check the Shift4 referral status")
    expect(mocks.listShift4PaymentAttempts).not.toHaveBeenCalled()
  })

  it("rejects a malformed payment reference before reading anything", async () => {
    const response = await referralStatusGET(referralRequest("not-a-uuid"))
    expect(response.status).toBe(400)
    expect(mocks.listShift4PaymentAttempts).not.toHaveBeenCalled()
  })

  it("returns only a payment reference and a boolean", async () => {
    mocks.listShift4PaymentAttempts.mockResolvedValue([attempt()])
    const response = await referralStatusGET(referralRequest())
    const body = (await response.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["paymentId", "referralRequired"])
    expect(response.headers.get("Cache-Control")).toBe("no-store")
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
      "responseCode:",
      "invoice",
      "amount",
    ]) {
      expect(referralRouteCode, forbidden).not.toContain(forbidden)
    }
  })
})

/* ========================================================================== */

describe("clerk submission", () => {
  it("sends nothing on mount — the panel has no effect at all", () => {
    renderExperience("shift4-referral")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(panelCode).not.toContain("useEffect")
  })

  it("submits only from the button's own handler", () => {
    expect(panelCode).toMatch(/onClick=\{\(\)\s*=>\s*void submit\(\)\}/)
    expect(panelCode).not.toMatch(/useEffect\([^)]*submit/)
  })

  it("guards double submission synchronously, before the first await", () => {
    const body = panelCode.slice(panelCode.indexOf("const submit ="))
    const guardRead = body.indexOf("if (inFlightRef.current) return")
    const guardSet = body.indexOf("inFlightRef.current = true")
    const firstAwait = body.indexOf("await")
    expect(guardRead).toBeGreaterThan(-1)
    expect(guardSet).toBeGreaterThan(guardRead)
    // Both happen before anything yields, so two clicks in one tick send one request.
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

  it("requires exactly six alphanumeric characters and uppercases them", () => {
    expect(panelCode).toContain("/^[A-Z0-9]{6}$/.test(code)")
    expect(panelCode).toContain('.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)')
    expect(panelCode).toContain("disabled={!valid || submitting}")
  })

  it("clears the code after a successful submission and after cancellation", () => {
    const submitBody = panelCode.slice(
      panelCode.indexOf("const submit ="),
      panelCode.indexOf("const cancel =")
    )
    const cancelBody = panelCode.slice(panelCode.indexOf("const cancel ="))
    expect(submitBody).toContain('setCode("")')
    expect(cancelBody).toContain('setCode("")')
  })

  it("never writes the code to the console or an error message", () => {
    expect(panelCode).not.toMatch(/console\.(log|warn|error|info|debug)/)
    expect(panelCode).not.toMatch(/(Error|message)[^\n]*\$\{?code/)
  })

  it("cancel sends no provider request", () => {
    const cancelBody = panelCode.slice(panelCode.indexOf("const cancel ="))
    expect(cancelBody).not.toContain("fetch(")
  })
})

/* ========================================================================== */

describe("submission route — server-derived, allow-listed, gated", () => {
  it("accepts a valid code without dispatching anything", async () => {
    const response = await manualAuthorizationPOST(
      manualRequest({ paymentId: PAYMENT_ID, authorizationCode: "ab12cd" })
    )
    const body = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(body.dispatchPermitted).toBe(false)
    expect(body.providerCallPerformed).toBe(false)
    expect(body.authorizationCodeAccepted).toBe(true)
    // The code itself never comes back.
    expect(JSON.stringify(body)).not.toMatch(/AB12CD/i)
  })

  it("reports that Retail execution is not enabled", async () => {
    const response = await manualAuthorizationPOST(
      manualRequest({ paymentId: PAYMENT_ID, authorizationCode: "AB12CD" })
    )
    const body = (await response.json()) as { blockedReason?: string }
    expect(body.blockedReason).toBeTruthy()
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
      const body = (await response.json()) as { error?: string }
      // The rejected value is never echoed back.
      expect(body.error ?? "").not.toContain(bad.trim() || " ")
    }
  })

  it("creates no attempt, ledger posting or provider call while gated", async () => {
    await manualAuthorizationPOST(manualRequest({ paymentId: PAYMENT_ID, authorizationCode: "AB12CD" }))
    expect(fetchSpy).not.toHaveBeenCalled()
    const routeCode = codeOnly(read("app/api/pos/shift4-manual-authorization/route.ts"))
    for (const writer of ["recordShift4", "insert(", "createAttempt", "ledger", "capture("]) {
      expect(routeCode, writer).not.toContain(writer)
    }
  })
})

/* ========================================================================== */

describe("POS lifecycle around the referral", () => {
  it("does not return to the keypad while the referral panel is open", () => {
    // The auto-reset timer is armed only by a real terminal card result.
    expect(layoutCode).toContain(
      'paymentMode === "card" && (cardView === "approved" || cardView === "declined")'
    )
    expect(layoutCode).not.toMatch(/cardView === "shift4-referral"[^\n]*resetSale/)
  })

  it("keeps the panel open across status polls that still say processing", () => {
    expect(layoutCode).toContain(
      'if (next === "processing" && !shift4ReferralActiveRef.current) setCardView("processing")'
    )
  })

  it("lets a real terminal outcome close the panel", () => {
    expect(layoutCode).toContain("if (terminalOutcome) shift4ReferralActiveRef.current = false")
  })

  it("opens the panel only from the server's referral answer", () => {
    expect(layoutCode).toContain("if (data?.referralRequired === true) showShift4Referral()")
    // Exactly one call site in the whole terminal, and it is that one. The
    // panel can never be opened from a guessed status, an error message, or a
    // response code the browser happens to be holding.
    const callSites = layoutCode.match(/(?<!function )showShift4Referral\(\)/g) ?? []
    expect(callSites).toHaveLength(1)
  })

  it("cancel is explicit, sends no provider request, and resolves nothing", () => {
    const dismissStart = layoutCode.indexOf("function dismissShift4Referral()")
    const dismiss = layoutCode.slice(dismissStart, layoutCode.indexOf("\n  }", dismissStart))
    expect(dismiss).toContain("shift4ReferralDismissedRef.current = true")
    // Back to the still-processing sale — not confirmed, not failed, not cancelled.
    expect(dismiss).toContain('setCardView("processing")')
    expect(dismiss).not.toContain("cancelSale")
    expect(dismiss).not.toContain("fetch(")
    expect(dismiss).not.toContain('setStatus("failed")')
    expect(dismiss).not.toContain('setStatus("confirmed")')
  })

  it("a dismissed referral is not re-opened for the same sale", () => {
    expect(layoutCode).toContain("if (shift4ReferralDismissedRef.current) return")
  })

  it("a new sale clears both referral flags", () => {
    const reset = layoutCode.slice(
      layoutCode.indexOf("function resetSale()"),
      layoutCode.indexOf("async function cancelSale()")
    )
    expect(reset).toContain("shift4ReferralActiveRef.current = false")
    expect(reset).toContain("shift4ReferralDismissedRef.current = false")
  })

  it("discards a referral answer that belongs to a superseded sale", () => {
    expect(layoutCode).toContain("if (stopped || myGeneration !== saleGenerationRef.current) return")
  })

  it("checks for a referral only while a card sale is processing", () => {
    expect(layoutCode).toContain(
      'if (paymentMode !== "card" || status !== "processing" || !pid || !token) return'
    )
  })
})
