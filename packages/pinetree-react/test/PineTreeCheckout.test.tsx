import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { CheckoutOpenResult } from "@pinetree/js"
import { PineTreeCheckout } from "../src/components/PineTreeCheckout"
import {
  destroyReactCheckout,
  openReactCheckout,
} from "../src/hooks"
import { PineTreeProvider } from "../src/provider"

describe("PineTreeCheckout", () => {
  it("renders its developer-owned container", () => {
    const markup = renderToStaticMarkup(
      createElement(
        PineTreeProvider,
        { publicKey: "pk_live_test" },
        createElement(PineTreeCheckout, {
          amount: 1000,
          className: "checkout-shell",
        })
      )
    )

    expect(markup).toContain('class="checkout-shell"')
  })

  it("opens embedded checkout with the supplied container", async () => {
    const container = { appendChild: vi.fn() } as unknown as HTMLElement
    const checkout = {
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
    } as unknown as CheckoutOpenResult
    const open = vi.fn().mockResolvedValue(checkout)
    const client = { checkout: { open } } as never

    await openReactCheckout(
      client,
      { amount: 1000, mode: "embedded", container },
      {}
    )

    expect(open).toHaveBeenCalledWith({
      amount: 1000,
      mode: "embedded",
      container,
    })
  })

  it("destroys embedded checkout during cleanup", () => {
    const checkout = {
      destroy: vi.fn(),
    } as unknown as CheckoutOpenResult

    destroyReactCheckout(checkout)

    expect(checkout.destroy).toHaveBeenCalledOnce()
  })
})
