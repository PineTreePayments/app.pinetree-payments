# Idempotency

PineTree supports idempotent session creation using an `Idempotency-Key` request header. This lets you safely retry failed requests without creating duplicate checkout sessions.

---

## Idempotency-Key header

Add the `Idempotency-Key` header to any `POST /api/v1/checkout/sessions` request:

```http
POST /api/v1/checkout/sessions
Authorization: Bearer pt_live_...
Content-Type: application/json
Idempotency-Key: order_1042
```

The value can be any string that uniquely identifies this operation — your order ID is a natural choice.

---

## Behavior

### Same key + same request body

If you send the same `Idempotency-Key` with the same request body, PineTree returns the original response. The session is not created again.

```typescript
// First request — creates session cs_01abc...
const session1 = await pinetree.checkout.sessions.create(
  { amount: 2500, reference: "order_1042" },
  { idempotencyKey: "order_1042" }
)

// Second request (identical body) — returns same session
const session2 = await pinetree.checkout.sessions.create(
  { amount: 2500, reference: "order_1042" },
  { idempotencyKey: "order_1042" }
)

console.log(session1.id === session2.id) // true — same session returned
```

### Same key + different request body

If you send the same `Idempotency-Key` with a **different** body, PineTree rejects the request with `409 Conflict`:

```json
{
  "error": {
    "type": "idempotency_error",
    "code": "idempotency_key_conflict",
    "message": "The Idempotency-Key was already used with a different request body."
  }
}
```

**Do not reuse idempotency keys with different amounts or references.** Each unique operation needs its own key.

### Request in progress

If a request with the same key is currently in progress (not yet completed), PineTree returns `409` with code `idempotency_request_in_progress`. Wait for the original request to complete before retrying.

---

## Safe to retry

Once a session is created, retrying the same request with the same `Idempotency-Key` is safe and will always return the original session. This means:

- A network timeout does not leave you uncertain about whether the session was created
- Your retry logic is safe and won't produce duplicate checkout sessions

---

## Recommended behavior

1. **Use your order ID as the idempotency key.** It is naturally unique per operation.
2. **Always include an idempotency key for session creation.** It costs nothing and eliminates duplicate sessions.
3. **Do not reuse keys across different orders.** A key collision with a different body causes a permanent `409` error for that key.
4. **Do not generate a new key for each retry attempt.** Use the same key — that is the entire point.

```typescript
// Good: order ID as key, safe to retry on timeout
const session = await pinetree.checkout.sessions.create(
  { amount: order.totalCents, reference: order.id },
  { idempotencyKey: order.id }
)

// Bad: new UUID for each call — no idempotency protection
const session = await pinetree.checkout.sessions.create(
  { amount: order.totalCents, reference: order.id },
  { idempotencyKey: crypto.randomUUID() } // unique each time = no protection
)
```

---

## Why idempotency matters for payment creation

Without an idempotency key, a network timeout between your server and the PineTree API leaves you uncertain:

- Did the session get created? If yes, retrying creates a second session.
- If not, the customer never sees a checkout link.

With an idempotency key, you can always safely retry. If the session was already created, you get the same session back. If it wasn't, it's created now.

---

## REST API

The `Idempotency-Key` header is supported on:

- `POST /api/v1/checkout/sessions` — session creation

It is not required or used on GET, cancel, expire, or retry endpoints.

---

## Node SDK

Pass `idempotencyKey` in the options object:

```typescript
const session = await pinetree.checkout.sessions.create(
  params,
  { idempotencyKey: "order_1042" }
)
```

The SDK sets the `Idempotency-Key` header automatically.
