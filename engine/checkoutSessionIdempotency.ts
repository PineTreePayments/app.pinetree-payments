import {
  claimApiIdempotency,
  completeApiIdempotencyClaim,
  getApiIdempotencyClaim,
  releaseApiIdempotencyClaim,
} from "@/database/apiIdempotencyClaims"
import type { PublicCheckoutSession } from "./publicCheckoutSessions"

export const V1_CREATE_SESSION_ROUTE = "POST:/api/v1/checkout/sessions"
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000
const CONCURRENT_WAIT_ATTEMPTS = 20
const CONCURRENT_WAIT_MS = 100

async function digestHex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  return value
}

export async function buildCheckoutSessionIdempotency(input: {
  key: string
  body: Record<string, unknown>
}) {
  return {
    keyHash: await digestHex(input.key),
    requestHash: await digestHex(JSON.stringify(canonicalize(input.body))),
  }
}

export async function claimCheckoutSessionIdempotency(input: {
  merchantId: string
  keyHash: string
  requestHash: string
}): Promise<
  | { state: "claimed"; claimId: string }
  | { state: "conflict" }
  | { state: "replay"; response: PublicCheckoutSession }
  | { state: "pending" }
> {
  const result = await claimApiIdempotency({
    merchantId: input.merchantId,
    route: V1_CREATE_SESSION_ROUTE,
    keyHash: input.keyHash,
    requestHash: input.requestHash,
    expiresAt: new Date(Date.now() + CLAIM_TTL_MS).toISOString(),
  })
  if (result.claim.request_hash !== input.requestHash) return { state: "conflict" }
  if (result.claim.response_body) {
    return {
      state: "replay",
      response: result.claim.response_body as PublicCheckoutSession,
    }
  }
  if (result.claimed) return { state: "claimed", claimId: result.claim.id }

  for (let attempt = 0; attempt < CONCURRENT_WAIT_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, CONCURRENT_WAIT_MS))
    const claim = await getApiIdempotencyClaim(
      input.merchantId,
      V1_CREATE_SESSION_ROUTE,
      input.keyHash
    )
    if (!claim) return { state: "pending" }
    if (claim.request_hash !== input.requestHash) return { state: "conflict" }
    if (claim.response_body) {
      return {
        state: "replay",
        response: claim.response_body as PublicCheckoutSession,
      }
    }
  }
  return { state: "pending" }
}

export async function completeCheckoutSessionIdempotency(
  claimId: string,
  session: PublicCheckoutSession
) {
  await completeApiIdempotencyClaim({
    claimId,
    resourceId: session.id,
    responseBody: session,
  })
}

export async function releaseCheckoutSessionIdempotency(claimId: string) {
  await releaseApiIdempotencyClaim(claimId)
}
