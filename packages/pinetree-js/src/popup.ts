import { CheckoutInitializationError } from "./errors"

const POPUP_WIDTH = 500
const POPUP_HEIGHT = 700

export function openPopup(): Window {
  const sw = (globalThis as unknown as { screen?: { width?: number } }).screen?.width ?? 1024
  const sh = (globalThis as unknown as { screen?: { height?: number } }).screen?.height ?? 768
  const left = Math.max(0, Math.round(sw / 2 - POPUP_WIDTH / 2))
  const top = Math.max(0, Math.round(sh / 2 - POPUP_HEIGHT / 2))

  const features = [
    `width=${POPUP_WIDTH}`,
    `height=${POPUP_HEIGHT}`,
    `left=${left}`,
    `top=${top}`,
    "toolbar=no",
    "menubar=no",
    "resizable=yes",
    "scrollbars=yes",
  ].join(",")

  // Access open through globalThis so tests can stub it with vi.stubGlobal("open", ...)
  const openFn = (globalThis as unknown as { open?: (url: string, target: string, features: string) => Window | null }).open
  // Reserve the popup synchronously while the browser still has user activation.
  // The checkout URL is assigned after session creation completes.
  const popup = openFn?.("about:blank", "pinetree-checkout", features) ?? null

  if (!popup) {
    throw new CheckoutInitializationError(
      "Popup was blocked by the browser. Allow popups for this site to use popup checkout mode.",
      { code: "popup_blocked", type: "initialization_error" }
    )
  }

  return popup
}

export function navigatePopup(popup: Window, checkoutUrl: string): void {
  try {
    popup.location.assign(checkoutUrl)
  } catch (cause) {
    popup.close()
    throw new CheckoutInitializationError(
      "The checkout popup could not be navigated to the hosted checkout.",
      { code: "popup_navigation_failed", type: "initialization_error", cause }
    )
  }
}
