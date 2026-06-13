import { NextResponse } from "next/server"

export type V1ErrorType =
  | "authentication_error"
  | "authorization_error"
  | "invalid_request_error"
  | "idempotency_error"
  | "not_found_error"
  | "api_error"

export class V1ApiError extends Error {
  readonly status: number
  readonly type: V1ErrorType
  readonly code: string

  constructor(input: {
    status: number
    type: V1ErrorType
    code: string
    message: string
  }) {
    super(input.message)
    this.name = "V1ApiError"
    this.status = input.status
    this.type = input.type
    this.code = input.code
  }
}

export function getV1RequestId(req: { headers: { get(name: string): string | null } }) {
  return req.headers.get("x-request-id") || crypto.randomUUID()
}

export function v1ErrorResponse(error: unknown, requestId?: string) {
  const resolved =
    error instanceof V1ApiError
      ? error
      : new V1ApiError({
          status: 500,
          type: "api_error",
          code: "internal_error",
          message: "An internal error occurred.",
        })

  return NextResponse.json(
    {
      error: {
        type: resolved.type,
        code: resolved.code,
        message: resolved.message,
        ...(requestId ? { requestId } : {}),
      },
    },
    {
      status: resolved.status,
      headers: requestId ? { "X-Request-Id": requestId } : undefined,
    }
  )
}
