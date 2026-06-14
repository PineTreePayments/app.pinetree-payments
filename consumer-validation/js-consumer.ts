// Consumer validation for @pinetreepayments/js
// Typechecked against dist/types — verifies all documented exports compile.
import PineTree, {
  PineTree as NamedPineTree,
  PineTreeBrowserError,
  CheckoutInitializationError,
  CheckoutSessionError,
} from "@pinetreepayments/js"
import type {
  PineTreeJSOptions,
  CheckoutOptions,
  CheckoutMode,
  CheckoutEventName,
  CheckoutEventPayload,
  CheckoutEvent,
  CheckoutEventHandler,
  CheckoutOpenResult,
  CheckoutSessionResult,
  CheckoutError,
} from "@pinetreepayments/js"

const _namedSameAsDefault: typeof PineTree = NamedPineTree

const _opts: PineTreeJSOptions = { publicKey: "pk_live_test", baseUrl: "http://localhost:3000" }
const client = new PineTree(_opts)
const _client2 = new PineTree("pk_live_test")

void (async () => {
  // Redirect mode (default)
  const _mode: CheckoutMode = "redirect"
  const redirectOptions: CheckoutOptions = {
    amount: 2500,
    currency: "USD",
    reference: "order_abc123",
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
  }
  const redirectResult: CheckoutOpenResult = await client.checkout.open(redirectOptions)
  const _sr: CheckoutSessionResult = redirectResult

  // Popup mode
  const popupResult: CheckoutOpenResult = await client.checkout.open({
    amount: 2500,
    mode: "popup",
  })
  void popupResult.popup

  // Embedded mode
  const embeddedResult: CheckoutOpenResult = await client.checkout.open({
    amount: 2500,
    mode: "embedded",
    container: "#checkout-container",
  })
  void embeddedResult.iframe

  // Lifecycle events
  const _eventName: CheckoutEventName = "complete"
  const handler: CheckoutEventHandler = (event: CheckoutEvent) => {
    const _p: CheckoutEventPayload = event
    void _p.source
    void _p.version
    void _p.event
    void _p.sessionId
    void _p.status
  }
  embeddedResult.on("complete", handler)
  embeddedResult.off("complete", handler)
  embeddedResult.destroy()

  // Error types
  const _err1: PineTreeBrowserError = new PineTreeBrowserError("msg")
  const _err2: CheckoutInitializationError = new CheckoutInitializationError("msg", { code: "popup_blocked" })
  const _err3: CheckoutSessionError = new CheckoutSessionError("msg")
  const _checkoutError: CheckoutError = { type: "api_error", code: "api_error", message: "fail" }
  void _checkoutError
})()
