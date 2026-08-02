import { randomBytes, randomUUID } from "node:crypto"
import { getShift4I4GoBrowserConfig } from "./config"
import type { Shift4I4GoSession } from "./types"

export function createShift4I4GoSession(input: {
  ttlSeconds?: number
}): Promise<Shift4I4GoSession> {
  const browser = getShift4I4GoBrowserConfig()
  if (!browser.configured) {
    throw Object.assign(new Error(browser.reason || "i4Go is not configured"), { status: 503, code: "i4go_not_configured" })
  }
  const sessionId = randomUUID()
  const completionSecret = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + Math.max(60, Math.min(input.ttlSeconds ?? 600, 900)) * 1000).toISOString()
  return Promise.resolve(Object.freeze({ sessionId, completionSecret, expiresAt, browser }))
}
