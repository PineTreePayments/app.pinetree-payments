import type { APIErrorPayload } from "./types"

export class PineTreeError extends Error {
  readonly status?: number
  readonly code?: string
  readonly type?: string
  readonly requestId?: string

  constructor(
    message: string,
    options: {
      status?: number
      code?: string
      type?: string
      requestId?: string
      cause?: unknown
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "PineTreeError"
    this.status = options.status
    this.code = options.code
    this.type = options.type
    this.requestId = options.requestId
  }
}

export class AuthenticationError extends PineTreeError {
  override name = "AuthenticationError"
}

export class PermissionError extends PineTreeError {
  override name = "PermissionError"
}

export class InvalidRequestError extends PineTreeError {
  override name = "InvalidRequestError"
}

export class APIConnectionError extends PineTreeError {
  override name = "APIConnectionError"
}

export class IdempotencyConflictError extends PineTreeError {
  override name = "IdempotencyConflictError"
}

export class WebhookVerificationError extends PineTreeError {
  override name = "WebhookVerificationError"
}

export function createAPIError(status: number, payload: APIErrorPayload): PineTreeError {
  const error = payload.error || {}
  const options = {
    status,
    code: error.code,
    type: error.type,
    requestId: error.requestId,
  }
  const message = error.message || `PineTree API request failed with status ${status}.`

  if (status === 401 || error.type === "authentication_error") {
    return new AuthenticationError(message, options)
  }
  if (status === 403 || error.type === "authorization_error") {
    return new PermissionError(message, options)
  }
  if (error.code === "idempotency_key_conflict") {
    return new IdempotencyConflictError(message, options)
  }
  if (status === 400 || status === 404 || status === 409 || error.type === "invalid_request_error") {
    return new InvalidRequestError(message, options)
  }
  return new PineTreeError(message, options)
}
