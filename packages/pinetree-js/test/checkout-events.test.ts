import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import PineTree from "../src"
import type {
  CheckoutEventHandler,
  CheckoutEventName,
  CheckoutOpenResult,
} from "../src"

const SESSION_ID = "sess_events_test"
const CHECKOUT_ORIGIN = "https://app.pinetree-payments.com"
const sessionResponse = {
  id: SESSION_ID,
  status: "open",
  checkoutUrl: `${CHECKOUT_ORIGIN}/checkout/tok_events`,
  reference: null,
  paymentId: null,
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 201,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

let listeners: EventListener[]
const addEventListener = vi.fn()
const removeEventListener = vi.fn()

function dispatchMessage(
  data: unknown,
  options: { origin?: string; source?: MessageEventSource | null } = {}
) {
  const message = {
    type: "message",
    data,
    origin: options.origin ?? CHECKOUT_ORIGIN,
    source: options.source ?? null,
  } as unknown as MessageEvent
  for (const listener of [...listeners]) listener(message)
}

function payload(event: string, overrides: Record<string, unknown> = {}) {
  return {
    source: "pinetree-checkout",
    version: 1,
    event,
    sessionId: SESSION_ID,
    status: event === "complete" ? "paid" : event,
    ...overrides,
  }
}

describe("checkout lifecycle events", () => {
  beforeEach(() => {
    listeners = []
    addEventListener.mockReset()
    removeEventListener.mockReset()
    addEventListener.mockImplementation((type: string, listener: EventListener) => {
      if (type === "message") listeners.push(listener)
    })
    removeEventListener.mockImplementation((type: string, listener: EventListener) => {
      if (type === "message") {
        listeners = listeners.filter((candidate) => candidate !== listener)
      }
    })
    vi.stubGlobal("addEventListener", addEventListener)
    vi.stubGlobal("removeEventListener", removeEventListener)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(sessionResponse)))
    vi.stubGlobal("location", { assign: vi.fn() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openSession(): Promise<CheckoutOpenResult> {
    return new PineTree("pk_live_test").checkout.open({
      amount: 2500,
      redirect: false,
    })
  }

  it.each([
    "complete",
    "failed",
    "expired",
    "canceled",
    "closed",
  ] satisfies CheckoutEventName[])("dispatches the %s event", async (eventName) => {
    const checkout = await openSession()
    const handler = vi.fn()
    checkout.on(eventName, handler)

    dispatchMessage(payload(eventName))

    expect(handler).toHaveBeenCalledWith(payload(eventName))
  })

  it("ignores wrong origin, session, version, and unsupported events", async () => {
    const checkout = await openSession()
    const handler = vi.fn()
    checkout.on("complete", handler)

    dispatchMessage(payload("complete"), { origin: "https://attacker.example" })
    dispatchMessage(payload("complete", { sessionId: "other-session" }))
    dispatchMessage(payload("complete", { version: 2 }))
    dispatchMessage(payload("unknown"))

    expect(handler).not.toHaveBeenCalled()
  })

  it("ignores a popup message from the wrong window", async () => {
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { assign: vi.fn() },
    } as unknown as Window
    vi.stubGlobal("open", vi.fn().mockReturnValue(popup))
    const checkout = await new PineTree("pk_live_test").checkout.open({
      amount: 2500,
      mode: "popup",
    })
    const handler = vi.fn()
    checkout.on("complete", handler)

    dispatchMessage(payload("complete"), { source: {} as Window })
    dispatchMessage(payload("complete"), { source: popup })

    expect(handler).toHaveBeenCalledOnce()
  })

  it("off removes the selected handler", async () => {
    const checkout = await openSession()
    const handler: CheckoutEventHandler = vi.fn()
    checkout.on("complete", handler)
    checkout.off("complete", handler)

    dispatchMessage(payload("complete"))

    expect(handler).not.toHaveBeenCalled()
  })

  it("destroy removes message listeners", async () => {
    const checkout = await openSession()
    const handler = vi.fn()
    checkout.on("complete", handler)
    checkout.destroy()

    expect(removeEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function)
    )
    dispatchMessage(payload("complete"))
    expect(handler).not.toHaveBeenCalled()
  })

  it("destroy removes the SDK-created iframe", async () => {
    const iframe = {
      contentWindow: {} as Window,
      remove: vi.fn(),
      src: "",
      style: {},
      setAttribute: vi.fn(),
    } as unknown as HTMLIFrameElement
    vi.stubGlobal("document", {
      querySelector: vi.fn(),
      createElement: vi.fn().mockReturnValue(iframe),
    })
    const checkout = await new PineTree("pk_live_test").checkout.open({
      amount: 2500,
      mode: "embedded",
      container: { appendChild: vi.fn() } as unknown as HTMLElement,
    })

    checkout.destroy()

    expect(iframe.remove).toHaveBeenCalledOnce()
  })

  it("destroy closes an open SDK-created popup", async () => {
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { assign: vi.fn() },
    } as unknown as Window
    vi.stubGlobal("open", vi.fn().mockReturnValue(popup))
    const checkout = await new PineTree("pk_live_test").checkout.open({
      amount: 2500,
      mode: "popup",
    })

    checkout.destroy()

    expect(popup.close).toHaveBeenCalledOnce()
  })
})
