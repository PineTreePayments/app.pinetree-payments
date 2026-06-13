import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PineTreeCheckoutButton } from "../src/components/PineTreeCheckoutButton"
import { isCheckoutButtonDisabled } from "../src/hooks"
import { PineTreeProvider } from "../src/provider"

describe("PineTreeCheckoutButton", () => {
  it("renders a button with consumer content", () => {
    const markup = renderToStaticMarkup(
      createElement(
        PineTreeProvider,
        { publicKey: "pk_live_test" },
        createElement(
          PineTreeCheckoutButton,
          { amount: 1000, currency: "USD", mode: "popup" },
          "Pay with PineTree"
        )
      )
    )

    expect(markup).toContain("<button")
    expect(markup).toContain("Pay with PineTree")
  })

  it("disables while opening or explicitly disabled", () => {
    expect(isCheckoutButtonDisabled(false, true)).toBe(true)
    expect(isCheckoutButtonDisabled(true, false)).toBe(true)
    expect(isCheckoutButtonDisabled(false, false)).toBe(false)
  })

  it("renders disabled state", () => {
    const markup = renderToStaticMarkup(
      createElement(
        PineTreeProvider,
        { publicKey: "pk_live_test" },
        createElement(PineTreeCheckoutButton, {
          amount: 1000,
          disabled: true,
        })
      )
    )
    expect(markup).toContain("disabled")
  })
})
