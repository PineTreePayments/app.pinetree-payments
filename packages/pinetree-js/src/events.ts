import type {
  CheckoutEventHandler,
  CheckoutEventName,
  CheckoutEventPayload,
  CheckoutOpenResult,
} from "./types"

const CHECKOUT_EVENT_VERSION = 1
const SUPPORTED_EVENTS = new Set<CheckoutEventName>([
  "complete",
  "failed",
  "expired",
  "canceled",
  "closed",
])

type SessionBase = {
  id: string
  status: string
  checkoutUrl: string
  reference: string | null
  paymentId: string | null
}

export class CheckoutSession implements CheckoutOpenResult {
  readonly sessionId: string
  readonly status: string
  readonly checkoutUrl: string
  readonly reference: string | null
  readonly paymentId: string | null
  readonly iframe?: HTMLIFrameElement
  readonly popup?: Window

  private readonly handlers = new Map<
    CheckoutEventName,
    Set<CheckoutEventHandler>
  >()
  private readonly expectedOrigin: string
  private readonly expectedSource?: MessageEventSource | null
  private messageListener: EventListener | null = null

  constructor(
    base: SessionBase,
    refs?: { iframe?: HTMLIFrameElement; popup?: Window }
  ) {
    this.sessionId = base.id
    this.status = base.status
    this.checkoutUrl = base.checkoutUrl
    this.reference = base.reference
    this.paymentId = base.paymentId
    this.iframe = refs?.iframe
    this.popup = refs?.popup
    this.expectedOrigin = new URL(base.checkoutUrl).origin
    this.expectedSource = refs?.iframe?.contentWindow ?? refs?.popup
  }

  on(event: CheckoutEventName, handler: CheckoutEventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    this.ensureMessageListener()
  }

  off(event: CheckoutEventName, handler: CheckoutEventHandler): void {
    const eventHandlers = this.handlers.get(event)
    eventHandlers?.delete(handler)
    if (eventHandlers?.size === 0) this.handlers.delete(event)
  }

  destroy(): void {
    if (this.messageListener) {
      try {
        globalThis.removeEventListener("message", this.messageListener)
      } catch {
        // Non-browser runtimes have no global event target.
      }
      this.messageListener = null
    }
    this.handlers.clear()
    this.iframe?.remove()
    if (this.popup && !this.popup.closed) {
      this.popup.close()
    }
  }

  private ensureMessageListener(): void {
    if (this.messageListener) return
    this.messageListener = (event: Event) => {
      this.handleMessage(event as MessageEvent)
    }
    try {
      globalThis.addEventListener("message", this.messageListener)
    } catch {
      // Non-browser runtimes can still use session fields but receive no events.
    }
  }

  private handleMessage(message: MessageEvent): void {
    if (message.origin !== this.expectedOrigin) return
    if (this.expectedSource && message.source !== this.expectedSource) return
    if (!message.data || typeof message.data !== "object") return

    const data = message.data as Record<string, unknown>
    if (data.source !== "pinetree-checkout") return
    if (data.version !== CHECKOUT_EVENT_VERSION) return
    if (data.sessionId !== this.sessionId) return
    if (typeof data.event !== "string") return
    if (!SUPPORTED_EVENTS.has(data.event as CheckoutEventName)) return
    if (typeof data.status !== "string") return

    const payload: CheckoutEventPayload = {
      source: "pinetree-checkout",
      version: CHECKOUT_EVENT_VERSION,
      event: data.event as CheckoutEventName,
      sessionId: this.sessionId,
      status: data.status,
    }
    for (const handler of this.handlers.get(payload.event) ?? []) {
      handler(payload)
    }
  }
}
