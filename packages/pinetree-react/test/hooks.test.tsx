import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type {
  CheckoutEventHandler,
  CheckoutEventName,
  CheckoutOpenResult,
} from "@pinetree/js"
import {
  destroyReactCheckout,
  openReactCheckout,
  openReactCheckoutWithError,
  usePineTree,
  wireCheckoutCallbacks,
} from "../src/hooks"
import { PineTreeProvider } from "../src/provider"

function makeCheckout(): CheckoutOpenResult {
  const handlers = new Map<CheckoutEventName, CheckoutEventHandler>()
  return {
    sessionId: "sess_1",
    status: "open",
    checkoutUrl: "https://app.pinetree-payments.com/checkout/token",
    reference: null,
    paymentId: null,
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    off: vi.fn((event) => handlers.delete(event)),
    destroy: vi.fn(),
  }
}

describe("PineTree React hooks", () => {
  it("provider creates one shared PineTree client", () => {
    const clients: unknown[] = []
    function Probe() {
      clients.push(usePineTree())
      return null
    }

    renderToStaticMarkup(
      createElement(
        PineTreeProvider,
        { publicKey: "pk_live_test" },
        createElement(Probe),
        createElement(Probe)
      )
    )

    expect(clients).toHaveLength(2)
    expect(clients[0]).toBe(clients[1])
  })

  it("usePineTree throws outside the provider", () => {
    function Probe() {
      usePineTree()
      return null
    }

    expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(
      "usePineTree() must be used inside a <PineTreeProvider>."
    )
  })

  it("opens checkout and wires lifecycle callbacks", async () => {
    const checkout = makeCheckout()
    const open = vi.fn().mockResolvedValue(checkout)
    const client = { checkout: { open } } as never
    const onStart = vi.fn()
    const onOpen = vi.fn()
    const onComplete = vi.fn()

    await expect(
      openReactCheckout(
        client,
        { amount: 1000, rails: ["base"], mode: "popup" },
        { onStart, onOpen, onComplete }
      )
    ).resolves.toBe(checkout)

    expect(open).toHaveBeenCalledWith({
      amount: 1000,
      rails: ["base"],
      mode: "popup",
    })
    expect(onStart).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith(checkout)
    expect(checkout.on).toHaveBeenCalledWith("complete", onComplete)
  })

  it("off cleanup removes wired callbacks", () => {
    const checkout = makeCheckout()
    const onFailed = vi.fn()
    const cleanup = wireCheckoutCallbacks(checkout, { onFailed })

    cleanup()

    expect(checkout.off).toHaveBeenCalledWith("failed", onFailed)
  })

  it("calls onError and rethrows checkout failures", async () => {
    const error = new Error("checkout failed")
    const client = {
      checkout: { open: vi.fn().mockRejectedValue(error) },
    } as never
    const onError = vi.fn()

    await expect(
      openReactCheckoutWithError(client, { amount: 1000 }, { onError })
    ).rejects.toBe(error)
    expect(onError).toHaveBeenCalledWith(error)
  })

  it("destroys checkout resources", () => {
    const checkout = makeCheckout()
    destroyReactCheckout(checkout)
    expect(checkout.destroy).toHaveBeenCalledOnce()
  })
})
