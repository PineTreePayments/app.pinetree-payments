import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import {
  WalletApiRouteError,
  walletError,
  walletErrorHttpStatus,
  walletOk,
} from "@/engine/wallet/walletErrors"

export function walletErrorResponse(error: unknown): NextResponse {
  if (error instanceof WalletApiRouteError) {
    return NextResponse.json(walletError(error.code, error.message, error.retryable), {
      status: walletErrorHttpStatus(error.code),
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  }
  console.error("[wallet-api] unhandled error", error instanceof Error ? error.message : error)
  return NextResponse.json(walletError("INTERNAL_ERROR", "Something went wrong. Please try again."), {
    status: 500,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  })
}

function attachCorrelationId<T extends { ok: boolean }>(body: T, correlationId?: string | null): T & { correlationId?: string } {
  const safeCorrelationId = String(correlationId || "").trim()
  if (!safeCorrelationId) return body
  return { ...body, correlationId: safeCorrelationId.slice(0, 40) }
}

/**
 * Authenticates the request, resolves the PineTree merchant id, and runs
 * `handler(merchantId)`, wrapping the result/error in the shared
 * {ok,data}/{ok,error} envelope. Every generic app/api/wallets/* route uses
 * this - never accept a merchant/account id supplied by the client. Routes
 * must call an engine/wallet/* function from the handler, never fetch()
 * another route or a provider-specific endpoint directly.
 */
export async function withWalletMerchant<T>(
  req: NextRequest,
  handler: (merchantId: string) => Promise<T>,
  options: { correlationId?: string | null } = {}
): Promise<NextResponse> {
  let merchantId: string
  try {
    merchantId = await requireMerchantIdFromRequest(req)
  } catch {
    return NextResponse.json(attachCorrelationId(walletError("UNAUTHORIZED", "Unauthorized."), options.correlationId), {
      status: 401,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  }

  try {
    const data = await handler(merchantId)
    return NextResponse.json(attachCorrelationId(walletOk(data), options.correlationId), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    if (error instanceof WalletApiRouteError) {
      return NextResponse.json(attachCorrelationId(walletError(error.code, error.message, error.retryable), options.correlationId), {
        status: walletErrorHttpStatus(error.code),
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      })
    }
    console.error("[wallet-api] unhandled error", error instanceof Error ? error.message : error)
    return NextResponse.json(attachCorrelationId(walletError("INTERNAL_ERROR", "Something went wrong. Please try again."), options.correlationId), {
      status: 500,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  }
}

export function requireIdempotencyKey(req: NextRequest): string {
  const key = req.headers.get("idempotency-key")?.trim()
  if (!key) {
    throw new WalletApiRouteError("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required for this request.")
  }
  if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Idempotency-Key is invalid.")
  }
  return key
}

export async function readWalletJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Content-Type must be application/json.")
  }
  const declaredLength = Number(req.headers.get("content-length") || "0")
  if (Number.isFinite(declaredLength) && declaredLength > 8_192) {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Request body is too large.")
  }
  const raw = await req.text()
  if (raw.length > 8_192) throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Request body is too large.")
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("not an object")
    return value as Record<string, unknown>
  } catch {
    throw new WalletApiRouteError("WALLET_VALIDATION_ERROR", "Request body must be valid JSON.")
  }
}
