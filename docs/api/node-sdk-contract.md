# PineTree Node SDK Contract Draft

This document describes the intended server-side SDK surface. It is not a
published package and adds no runtime dependency.

```ts
await pinetree.checkout.sessions.create(params)
await pinetree.checkout.sessions.retrieve(id)
await pinetree.checkout.sessions.list(filters)
await pinetree.checkout.sessions.cancel(id)
await pinetree.checkout.sessions.expire(id)
await pinetree.payments.retrieve(id)
await pinetree.webhooks.constructEvent(rawBody, signature, secret, timestamp)
await pinetree.webhookDeliveries.list(filters)
await pinetree.webhookDeliveries.retry(id)
```

The canonical TypeScript definitions live in `types/pinetreeSdk.ts`.

Webhook verification uses the raw request body and HMAC-SHA256. V1 deliveries
include `PineTree-Signature`, `PineTree-Timestamp`, `PineTree-Event-Id`, and
`PineTree-Webhook-Version: 2026-06-12`; legacy `X-PineTree-*` headers remain.

Expired completed idempotency claims can be removed through the protected
internal cleanup helper. Vercel cron is not available on the current plan, so
no automatic schedule is configured.
