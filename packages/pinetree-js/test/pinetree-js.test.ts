import { describe, expect, it } from "vitest"
import PineTree, {
  CheckoutInitializationError,
  CheckoutSessionError,
  PineTreeBrowserError,
} from "../src"

describe("PineTree browser SDK", () => {
  describe("constructor", () => {
    it("accepts a public key string", () => {
      const client = new PineTree("pk_live_test")
      expect(client).toBeTruthy()
      expect(client.checkout).toBeTruthy()
    })

    it("accepts an options object with publicKey", () => {
      const client = new PineTree({ publicKey: "pk_live_test" })
      expect(client).toBeTruthy()
    })

    it("accepts an options object with publicKey and baseUrl", () => {
      const client = new PineTree({
        publicKey: "pk_live_test",
        baseUrl: "http://localhost:3000",
      })
      expect(client).toBeTruthy()
    })

    it("throws CheckoutInitializationError for an empty public key string", () => {
      expect(() => new PineTree("")).toThrow(CheckoutInitializationError)
      expect(() => new PineTree("  ")).toThrow(CheckoutInitializationError)
    })

    it("throws CheckoutInitializationError for an empty publicKey in options", () => {
      expect(() => new PineTree({ publicKey: "" })).toThrow(CheckoutInitializationError)
    })

    it("checkout resource is accessible via client.checkout", () => {
      const client = new PineTree("pk_live_test")
      expect(typeof client.checkout.open).toBe("function")
    })
  })

  describe("error classes", () => {
    it("PineTreeBrowserError carries code and type properties", () => {
      const err = new PineTreeBrowserError("bad input", {
        code: "invalid_options",
        type: "initialization_error",
      })
      expect(err.code).toBe("invalid_options")
      expect(err.type).toBe("initialization_error")
      expect(err.name).toBe("PineTreeBrowserError")
      expect(err.message).toBe("bad input")
    })

    it("CheckoutInitializationError name and hierarchy are correct", () => {
      const err = new CheckoutInitializationError("missing public key")
      expect(err.name).toBe("CheckoutInitializationError")
      expect(err.message).toBe("missing public key")
      expect(err).toBeInstanceOf(PineTreeBrowserError)
      expect(err).toBeInstanceOf(Error)
    })

    it("CheckoutSessionError name and hierarchy are correct", () => {
      const err = new CheckoutSessionError("payment failed", {
        code: "payment_failed",
      })
      expect(err.name).toBe("CheckoutSessionError")
      expect(err.code).toBe("payment_failed")
      expect(err).toBeInstanceOf(PineTreeBrowserError)
      expect(err).toBeInstanceOf(Error)
    })

    it("error cause is threaded through correctly", () => {
      const cause = new Error("upstream cause")
      const err = new PineTreeBrowserError("wrapper", { cause })
      expect((err as unknown as { cause: Error }).cause).toBe(cause)
    })
  })
})
