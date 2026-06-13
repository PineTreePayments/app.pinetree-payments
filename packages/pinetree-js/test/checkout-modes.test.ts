import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import PineTree, { CheckoutInitializationError } from "../src"

const SESSION_ID = "sess_mode_test"
const CHECKOUT_URL = "https://app.pinetree-payments.com/checkout/tok_mode"
const sessionResponse = {
  id: SESSION_ID,
  status: "open",
  checkoutUrl: CHECKOUT_URL,
  reference: "order-1",
  paymentId: null,
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 201,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function makeContainer() {
  return { appendChild: vi.fn() } as unknown as HTMLElement
}

function makeIframe() {
  return {
    contentWindow: {} as Window,
    src: "",
    style: { width: "", height: "", border: "" } as CSSStyleDeclaration,
    setAttribute: vi.fn(),
  } as unknown as HTMLIFrameElement
}

function makePopup() {
  return {
    close: vi.fn(),
    location: { assign: vi.fn() },
  } as unknown as Window
}

describe("checkout.open() modes", () => {
  const mockFetch = vi.fn()
  const mockAssign = vi.fn()
  const mockOpen = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch)
    vi.stubGlobal("location", { assign: mockAssign })
    vi.stubGlobal("open", mockOpen)
    mockFetch.mockReset()
    mockAssign.mockReset()
    mockOpen.mockReset()
    mockFetch.mockResolvedValue(okResponse(sessionResponse))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("redirects to checkoutUrl by default", async () => {
    const result = await new PineTree("pk_live_test").checkout.open({ amount: 2500 })

    expect(mockAssign).toHaveBeenCalledWith(CHECKOUT_URL)
    expect(result).toMatchObject({
      sessionId: SESSION_ID,
      checkoutUrl: CHECKOUT_URL,
    })
    expect(typeof result.on).toBe("function")
  })

  it("preserves legacy redirect false when mode is omitted", async () => {
    await new PineTree("pk_live_test").checkout.open({
      amount: 2500,
      redirect: false,
    })

    expect(mockAssign).not.toHaveBeenCalled()
  })

  it("rejects an unsupported JavaScript mode before creating a session", async () => {
    await expect(
      new PineTree("pk_live_test").checkout.open({
        amount: 2500,
        mode: "modal" as never,
      })
    ).rejects.toMatchObject({ code: "invalid_checkout_mode" })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("opens and centers a popup before navigating it to checkoutUrl", async () => {
    const popup = makePopup()
    mockOpen.mockReturnValue(popup)

    const result = await new PineTree("pk_live_test").checkout.open({
      amount: 2500,
      mode: "popup",
    })

    expect(mockOpen).toHaveBeenCalledWith(
      "about:blank",
      "pinetree-checkout",
      expect.stringContaining("width=500")
    )
    expect(mockOpen.mock.calls[0][2]).toContain("height=700")
    expect(popup.location.assign).toHaveBeenCalledWith(CHECKOUT_URL)
    expect(result.popup).toBe(popup)
  })

  it("throws when the popup is blocked without creating a session", async () => {
    mockOpen.mockReturnValue(null)

    await expect(
      new PineTree("pk_live_test").checkout.open({ amount: 2500, mode: "popup" })
    ).rejects.toMatchObject({
      name: "CheckoutInitializationError",
      code: "popup_blocked",
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("closes the reserved popup when session creation fails", async () => {
    const popup = makePopup()
    mockOpen.mockReturnValue(popup)
    mockFetch.mockRejectedValue(new Error("offline"))

    await expect(
      new PineTree("pk_live_test").checkout.open({ amount: 2500, mode: "popup" })
    ).rejects.toThrow()
    expect(popup.close).toHaveBeenCalledOnce()
  })

  it("appends a safely configured iframe to an HTMLElement", async () => {
    const iframe = makeIframe()
    const container = makeContainer()
    vi.stubGlobal("document", {
      querySelector: vi.fn(),
      createElement: vi.fn().mockReturnValue(iframe),
    })

    const result = await new PineTree("pk_live_test").checkout.open({
      amount: 2500,
      mode: "embedded",
      container,
    })

    expect(iframe.src).toBe(CHECKOUT_URL)
    expect(iframe.setAttribute).toHaveBeenCalledWith("allow", "payment")
    expect(iframe.setAttribute).toHaveBeenCalledWith(
      "sandbox",
      expect.stringContaining("allow-scripts")
    )
    expect(iframe.setAttribute).toHaveBeenCalledWith(
      "referrerpolicy",
      "strict-origin-when-cross-origin"
    )
    expect(container.appendChild).toHaveBeenCalledWith(iframe)
    expect(result.iframe).toBe(iframe)
  })

  it("resolves an embedded container selector", async () => {
    const iframe = makeIframe()
    const container = makeContainer()
    const querySelector = vi.fn().mockReturnValue(container)
    vi.stubGlobal("document", {
      querySelector,
      createElement: vi.fn().mockReturnValue(iframe),
    })

    await new PineTree("pk_live_test").checkout.open({
      amount: 2500,
      mode: "embedded",
      container: "#checkout",
    })

    expect(querySelector).toHaveBeenCalledWith("#checkout")
    expect(container.appendChild).toHaveBeenCalledWith(iframe)
  })

  it("rejects a missing embedded container before creating a session", async () => {
    vi.stubGlobal("document", {
      querySelector: vi.fn(),
      createElement: vi.fn(),
    })

    await expect(
      new PineTree("pk_live_test").checkout.open({
        amount: 2500,
        mode: "embedded",
      })
    ).rejects.toBeInstanceOf(CheckoutInitializationError)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("rejects a selector that does not match a container", async () => {
    vi.stubGlobal("document", {
      querySelector: vi.fn().mockReturnValue(null),
      createElement: vi.fn(),
    })

    await expect(
      new PineTree("pk_live_test").checkout.open({
        amount: 2500,
        mode: "embedded",
        container: "#missing",
      })
    ).rejects.toMatchObject({ code: "container_not_found" })
  })
})
