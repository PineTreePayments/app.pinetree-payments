import type { Shift4I4GoBrowserConfig } from "./types"

function safeHttpsUrl(value: string | undefined): string | null {
  try {
    const url = new URL(String(value || ""))
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Returns only administrator-provided official values. PineTree does not infer
 * provider URLs, field names, iframe messages, or a tokenization wire schema.
 */
export function getShift4I4GoBrowserConfig(env: Readonly<Record<string, string | undefined>> = process.env): Shift4I4GoBrowserConfig {
  const scriptUrl = safeHttpsUrl(env.SHIFT4_I4GO_SCRIPT_URL)
  const iframe = safeHttpsUrl(env.SHIFT4_I4GO_IFRAME_ORIGIN)
  const applicationId = String(env.SHIFT4_I4GO_APPLICATION_ID || "").trim() || null
  const configured = Boolean(scriptUrl && iframe && applicationId)
  return Object.freeze({
    configured,
    scriptUrl,
    iframeOrigin: iframe ? new URL(iframe).origin : null,
    applicationId,
    reason: configured ? null : "Official i4Go script URL, iframe origin, and application ID are required",
  })
}
