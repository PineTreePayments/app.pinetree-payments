import type { PineTreeBrowserClient } from "./client"
import { CheckoutInitializationError } from "./errors"
import { CheckoutSession } from "./events"
import { openEmbedded, resolveContainer, type EmbeddedContainer } from "./embed"
import { navigatePopup, openPopup } from "./popup"
import type { CheckoutMode, CheckoutOpenResult, CheckoutOptions } from "./types"

type ApiCheckoutSession = {
  id: string
  status: string
  checkoutUrl: string
  reference: string | null
  paymentId: string | null
}

/**
 * Browser checkout resource. Exposes pinetree.checkout.open() for creating
 * checkout sessions from browser code using a public key.
 */
export class CheckoutResource {
  constructor(private readonly _client: PineTreeBrowserClient) {}

  /**
   * Create a checkout session and launch the PineTree checkout experience.
   *
   * Modes:
   * - "redirect" (default): navigates the page to checkoutUrl
   * - "popup": opens a centered popup window
   * - "embedded": renders an iframe inside the provided container element
   *
   * Returns a CheckoutOpenResult with versioned lifecycle subscriptions and
   * cleanup methods for SDK-owned popup and iframe resources.
   */
  async open(options: CheckoutOptions): Promise<CheckoutOpenResult> {
    const mode: CheckoutMode = options.mode ?? "redirect"
    if (!["redirect", "popup", "embedded"].includes(mode)) {
      throw new CheckoutInitializationError(
        `Unsupported checkout mode: ${String(mode)}.`,
        { code: "invalid_checkout_mode", type: "initialization_error" }
      )
    }
    let popup: Window | undefined
    let embeddedContainer: EmbeddedContainer | undefined

    if (mode === "popup") {
      popup = openPopup()
    } else if (mode === "embedded") {
      // Validate before creating a server-side session so initialization errors
      // do not leave an unused open checkout session behind.
      embeddedContainer = resolveContainer(options.container)
    }

    const body: Record<string, unknown> = { amount: options.amount }
    if (options.currency !== undefined) body.currency = options.currency
    if (options.reference !== undefined) body.reference = options.reference
    if (options.customer !== undefined) body.customer = options.customer
    if (options.metadata !== undefined) body.metadata = options.metadata
    if (options.rails !== undefined) body.rails = options.rails
    if (options.successUrl !== undefined) body.successUrl = options.successUrl
    if (options.cancelUrl !== undefined) body.cancelUrl = options.cancelUrl

    let session: ApiCheckoutSession
    try {
      session = await this._client.request<ApiCheckoutSession>(
        "/api/v1/browser/checkout/sessions",
        { method: "POST", body }
      )
    } catch (error) {
      popup?.close()
      throw error
    }

    if (popup) {
      navigatePopup(popup, session.checkoutUrl)
      return new CheckoutSession(session, { popup })
    }

    if (embeddedContainer) {
      const iframe = openEmbedded(session.checkoutUrl, embeddedContainer)
      return new CheckoutSession(session, { iframe })
    }

    // redirect mode (default)
    // When mode is explicit ("redirect"), always redirect.
    // When mode is not set, respect the legacy redirect: false option used in tests.
    const shouldRedirect = options.mode ? true : options.redirect !== false
    if (shouldRedirect) {
      globalThis.location.assign(session.checkoutUrl)
    }
    return new CheckoutSession(session)
  }
}
