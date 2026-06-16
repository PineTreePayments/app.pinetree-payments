# API Errors

All API errors return a consistent JSON structure with an `error` object. HTTP status codes and error types are predictable and machine-readable.

---

## Error response shape

```json
{
  "error": {
    "type": "authentication_error",
    "code": "missing_api_key",
    "message": "A PineTree API key is required.",
    "requestId": "req_01abc..."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Broad error category — see types below |
| `code` | string | Specific machine-readable error code |
| `message` | string | Human-readable description |
| `requestId` | string | Unique request ID for support — also in the `X-Request-Id` response header |

---

## Error types

| Type | HTTP Status | Description |
|------|-------------|-------------|
| `authentication_error` | 401 | Missing or invalid API key |
| `authorization_error` | 403 | Valid key but lacks required permission |
| `invalid_request_error` | 400 | Malformed request, missing required field, or validation failure |
| `idempotency_error` | 409 | Idempotency key conflict |
| `not_found_error` | 404 | Requested resource does not exist |
| `api_error` | 500 | Internal server error |

---

## Authentication errors (401)

| Code | Description |
|------|-------------|
| `missing_api_key` | No `Authorization: Bearer` header provided |
| `invalid_api_key` | Key format is wrong (not `pt_live_*`) or key does not exist |
| `missing_public_key` | Browser route missing `X-PineTree-Public-Key` header |
| `invalid_public_key` | Public key is invalid or disabled |

---

## Authorization errors (403)

| Code | Description |
|------|-------------|
| `missing_permission` | API key does not have the required scope for this endpoint |

---

## Validation errors (400)

| Code | Endpoint | Description |
|------|----------|-------------|
| `invalid_json` | POST routes | Request body is not valid JSON |
| `invalid_amount` | Create session | `amount` is missing, non-numeric, zero, or negative |
| `invalid_customer` | Create session | `customer` is not an object |
| `invalid_metadata` | Create session | `metadata` is not an object |
| `invalid_rails` | Create session | `rails` contains unsupported or invalid rail identifiers |
| `missing_session_id` | Session routes | Session ID parameter is empty |
| `invalid_filter` | List endpoints | A query filter value is invalid (e.g., `limit` out of range) |
| `unsupported_status` | List sessions | `status` filter value is not a recognized checkout session status |
| `invalid_cursor` | List endpoints | Pagination cursor is malformed |

---

## Idempotency errors (409)

| Code | Description |
|------|-------------|
| `idempotency_key_conflict` | The same `Idempotency-Key` was used with a different request body |
| `idempotency_request_in_progress` | A request with this key is already in progress — retry after it completes |

---

## Not found errors (404)

| Code | Description |
|------|-------------|
| `checkout_session_not_found` | No session found for the given ID and your merchant account |
| `payment_not_found` | No payment found for the given ID and your merchant account |
| `webhook_delivery_not_found` | No webhook delivery found for the given ID |

---

## Internal errors (500)

| Code | Description |
|------|-------------|
| `internal_error` | An unexpected error occurred on the PineTree platform. Include the `requestId` when contacting support. |

---

## Lifecycle / state errors (400)

| Code | Description |
|------|-------------|
| `checkout_session_not_cancelable` | Session is already in a terminal state and cannot be canceled |

---

## HTTP status code reference

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Created (session created) |
| `400` | Bad request — validation error |
| `401` | Unauthenticated — invalid or missing API key |
| `403` | Forbidden — insufficient permissions |
| `404` | Not found |
| `409` | Conflict — idempotency error or state conflict |
| `500` | Internal server error |

---

## Node SDK error classes

When using `@pinetreepayments/node`, API errors are thrown as typed exceptions:

| Class | Condition |
|-------|-----------|
| `AuthenticationError` | `401` — invalid or missing key |
| `PermissionError` | `403` — insufficient scope |
| `InvalidRequestError` | `400`, `404`, `409` (non-idempotency) — validation or not-found |
| `IdempotencyConflictError` | `409` with `code: idempotency_key_conflict` |
| `APIConnectionError` | Network failure or request timeout |
| `WebhookVerificationError` | Webhook signature verification failure |
| `PineTreeError` | Base class for all SDK errors — `500` or unknown |

All errors expose: `.message`, `.status`, `.code`, `.type`, `.requestId`.

---

## Handling errors in the Node SDK

```typescript
import {
  AuthenticationError,
  PermissionError,
  InvalidRequestError,
  IdempotencyConflictError,
  APIConnectionError,
} from "@pinetreepayments/node"

try {
  const session = await pinetree.checkout.sessions.create({ amount: 2500 })
} catch (err) {
  if (err instanceof AuthenticationError) {
    // Rotate API key, check env vars
  } else if (err instanceof PermissionError) {
    // Key needs checkout.sessions:create permission
  } else if (err instanceof IdempotencyConflictError) {
    // Do not retry with same key — this key was used with different body
  } else if (err instanceof InvalidRequestError) {
    // Fix the request body — check err.code for specifics
  } else if (err instanceof APIConnectionError) {
    // Network issue — safe to retry with backoff
  }
}
```
