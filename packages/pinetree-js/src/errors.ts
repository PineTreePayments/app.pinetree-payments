/**
 * Base class for all @pinetree/js errors.
 */
export class PineTreeBrowserError extends Error {
  readonly code?: string
  readonly type?: string

  constructor(
    message: string,
    options: { code?: string; type?: string; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "PineTreeBrowserError"
    this.code = options.code
    this.type = options.type
  }
}

/**
 * Thrown when the PineTree browser client cannot be initialized.
 * Common causes: missing or empty public key, invalid options object.
 */
export class CheckoutInitializationError extends PineTreeBrowserError {
  override name = "CheckoutInitializationError"
}

/**
 * Thrown when a checkout session fails after initialization has succeeded.
 * Common causes: network failure, API error, user cancellation, session expiry.
 */
export class CheckoutSessionError extends PineTreeBrowserError {
  override name = "CheckoutSessionError"
}
