// Browser SDK public types. Server API keys and webhook secrets are not exposed.

export type PineTreeJSOptions = {
  publicKey: string
  baseUrl?: string
}

export type CheckoutMode = "redirect" | "popup" | "embedded"

export type CheckoutOptions = {
  amount: number
  currency?: string
  reference?: string
  customer?: {
    email?: string
  }
  metadata?: Record<string, unknown>
  rails?: string[]
  successUrl?: string
  cancelUrl?: string
  mode?: CheckoutMode
  container?: string | HTMLElement
  /**
   * @deprecated Use `mode` instead. When `mode` is omitted, false suppresses
   * redirect navigation for backward compatibility.
   */
  redirect?: boolean
}

export type CheckoutSessionResult = {
  sessionId: string
  status: string
  checkoutUrl: string
  reference: string | null
  paymentId: string | null
}

export type CheckoutEventName =
  | "complete"
  | "failed"
  | "expired"
  | "canceled"
  | "closed"

export type CheckoutEventPayload = {
  source: "pinetree-checkout"
  version: 1
  event: CheckoutEventName
  sessionId: string
  status: string
}

export type CheckoutEvent = CheckoutEventPayload
export type CheckoutEventHandler = (event: CheckoutEventPayload) => void

export type CheckoutOpenResult = CheckoutSessionResult & {
  iframe?: HTMLIFrameElement
  popup?: Window
  on(event: CheckoutEventName, handler: CheckoutEventHandler): void
  off(event: CheckoutEventName, handler: CheckoutEventHandler): void
  destroy(): void
}

export type CheckoutError = {
  type: string
  code: string
  message: string
}
