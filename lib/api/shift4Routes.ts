import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { getRouteErrorStatus } from "./merchantAuth"

type CodedError = Error & { code?: string; status?: number }

export function shift4Success<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status })
}

export function shift4Error(error: unknown, fallback = "Shift4 request failed") {
  const correlationId = randomUUID()
  const status = getRouteErrorStatus(error)
  const typed = error instanceof Error ? (error as CodedError) : null
  const safeMessage = status >= 500 && typed?.code !== "shift4_not_ready"
    ? fallback
    : typed?.message || fallback
  return NextResponse.json({
    ok: false,
    error: {
      code: typed?.code || (status >= 500 ? "internal_error" : "request_failed"),
      message: safeMessage,
      correlationId,
    },
  }, { status })
}

export function requireIdempotencyKey(headers: Headers): string {
  const key = String(headers.get("idempotency-key") || "").trim()
  if (!key || key.length > 200) {
    throw Object.assign(new Error("A valid Idempotency-Key header is required"), { status: 400, code: "idempotency_key_required" })
  }
  return key
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("A JSON object body is required"), { status: 400, code: "invalid_json" })
  }
  return body as Record<string, unknown>
}

export const requiredString = (body: Record<string, unknown>, key: string): string => {
  const value = typeof body[key] === "string" ? body[key].trim() : ""
  if (!value) throw Object.assign(new Error(`${key} is required`), { status: 400, code: "invalid_request" })
  return value
}

export const requiredMinorUnits = (body: Record<string, unknown>, key = "amountMinor"): number => {
  const value = body[key]
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw Object.assign(new Error(`${key} must be a positive integer in minor units`), { status: 400, code: "invalid_amount" })
  }
  return Number(value)
}
