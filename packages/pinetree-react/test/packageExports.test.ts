import { describe, expect, it } from "vitest"
import {
  PineTreeCheckout,
  PineTreeCheckoutButton,
  PineTreeProvider,
  usePineTree,
} from "../src"

describe("@pinetree/react exports", () => {
  it("exports the provider, hook, and checkout components", () => {
    expect(PineTreeProvider).toBeTypeOf("function")
    expect(usePineTree).toBeTypeOf("function")
    expect(PineTreeCheckoutButton).toBeTypeOf("function")
    expect(PineTreeCheckout).toBeTypeOf("function")
  })
})
