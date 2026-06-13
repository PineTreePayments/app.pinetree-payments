export type HostedCheckoutEventName =
  | "complete"
  | "failed"
  | "expired"
  | "canceled"
  | "closed"

export type HostedCheckoutEventPayload = {
  source: "pinetree-checkout"
  version: 1
  event: HostedCheckoutEventName
  sessionId: string
  status: string
}

export function getHostedCheckoutTerminalEvent(status: unknown): {
  event: Exclude<HostedCheckoutEventName, "closed">
  status: string
} | null {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "CONFIRMED") return { event: "complete", status: "paid" }
  if (normalized === "FAILED") return { event: "failed", status: "failed" }
  if (normalized === "EXPIRED") return { event: "expired", status: "expired" }
  if (["CANCELED", "CANCELLED", "INCOMPLETE"].includes(normalized)) {
    return { event: "canceled", status: "canceled" }
  }
  return null
}

export function postHostedCheckoutEvent(
  sessionId: string,
  event: HostedCheckoutEventName,
  status: string
): HostedCheckoutEventPayload | null {
  const normalizedSessionId = String(sessionId || "").trim()
  if (!normalizedSessionId || typeof window === "undefined") return null

  const payload: HostedCheckoutEventPayload = {
    source: "pinetree-checkout",
    version: 1,
    event,
    sessionId: normalizedSessionId,
    status,
  }

  if (window.parent && window.parent !== window) {
    window.parent.postMessage(payload, "*")
  }
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(payload, "*")
  }
  return payload
}
