import { CheckoutInitializationError } from "./errors"

// Access document through globalThis so tests can stub it with vi.stubGlobal("document", ...)
function getDocument(): Document | undefined {
  return (globalThis as unknown as { document?: Document }).document
}

function isAppendable(v: unknown): v is { appendChild(node: unknown): unknown } {
  return typeof v === "object" && v !== null && typeof (v as { appendChild?: unknown }).appendChild === "function"
}

export type EmbeddedContainer = {
  appendChild(node: unknown): unknown
}

export function resolveContainer(
  container: string | HTMLElement | undefined
): EmbeddedContainer {
  const doc = getDocument()
  if (!doc) {
    throw new CheckoutInitializationError(
      "document is not available. Embedded checkout requires a browser environment.",
      { code: "no_document", type: "initialization_error" }
    )
  }
  if (container === undefined || container === null) {
    throw new CheckoutInitializationError(
      "container is required for embedded checkout mode.",
      { code: "missing_container", type: "initialization_error" }
    )
  }
  if (typeof container === "string") {
    let el: Element | null
    try {
      el = doc.querySelector(container)
    } catch (cause) {
      throw new CheckoutInitializationError(
        `The container selector "${container}" is invalid.`,
        { code: "invalid_container_selector", type: "initialization_error", cause }
      )
    }
    if (!el || !isAppendable(el)) {
      throw new CheckoutInitializationError(
        `No element found matching selector "${container}".`,
        { code: "container_not_found", type: "initialization_error" }
      )
    }
    return el
  }
  if (!isAppendable(container)) {
    throw new CheckoutInitializationError(
      "container must be a CSS selector string or an HTMLElement.",
      { code: "invalid_container", type: "initialization_error" }
    )
  }
  return container
}

export function openEmbedded(
  checkoutUrl: string,
  container: EmbeddedContainer
): HTMLIFrameElement {
  const doc = getDocument()
  if (!doc) {
    throw new CheckoutInitializationError(
      "document is not available. Embedded checkout requires a browser environment.",
      { code: "no_document", type: "initialization_error" }
    )
  }
  const iframe = doc.createElement("iframe") as HTMLIFrameElement
  iframe.src = checkoutUrl
  iframe.setAttribute("allow", "payment")
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
  )
  iframe.style.width = "100%"
  iframe.style.height = "100%"
  iframe.style.border = "none"
  iframe.setAttribute("title", "PineTree secure checkout")
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin")
  iframe.setAttribute("data-pinetree-checkout", "true")
  container.appendChild(iframe)
  return iframe
}
