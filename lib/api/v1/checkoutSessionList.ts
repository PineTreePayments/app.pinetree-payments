import type { PublicCheckoutSessionStatus } from "@/engine/publicCheckoutSessionStatus"
import { V1ApiError } from "./errors"

const SUPPORTED_STATUSES: PublicCheckoutSessionStatus[] = [
  "open",
  "processing",
  "paid",
  "failed",
  "expired",
  "canceled",
]

function parseDate(value: string | null, field: string) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new V1ApiError({
      status: 400,
      type: "invalid_request_error",
      code: "invalid_filter",
      message: `${field} must be a valid ISO date.`,
    })
  }
  return date.toISOString()
}

export function parseCheckoutSessionListQuery(url: string) {
  const params = new URL(url).searchParams
  const rawLimit = params.get("limit")
  const limit = rawLimit === null ? 10 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new V1ApiError({
      status: 400,
      type: "invalid_request_error",
      code: "invalid_filter",
      message: "limit must be an integer between 1 and 100.",
    })
  }

  const statusValue = params.get("status")
  if (statusValue && !SUPPORTED_STATUSES.includes(statusValue as PublicCheckoutSessionStatus)) {
    throw new V1ApiError({
      status: 400,
      type: "invalid_request_error",
      code: "unsupported_status",
      message: "status is not supported.",
    })
  }

  const rawCursor = params.get("starting_after") || params.get("cursor")
  let cursor: { createdAt: string; id: string } | undefined
  if (rawCursor) {
    try {
      const parsed = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8"))
      if (!parsed.createdAt || !parsed.id || Number.isNaN(new Date(parsed.createdAt).getTime())) {
        throw new Error("invalid")
      }
      cursor = { createdAt: new Date(parsed.createdAt).toISOString(), id: String(parsed.id) }
    } catch {
      throw new V1ApiError({
        status: 400,
        type: "invalid_request_error",
        code: "invalid_cursor",
        message: "The pagination cursor is invalid.",
      })
    }
  }

  return {
    limit,
    cursor,
    status: statusValue as PublicCheckoutSessionStatus | undefined,
    reference: params.get("reference")?.trim() || undefined,
    createdAfter: parseDate(params.get("created_after"), "created_after"),
    createdBefore: parseDate(params.get("created_before"), "created_before"),
  }
}
