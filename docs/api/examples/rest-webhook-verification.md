# REST API — Webhook Verification (No SDK)

If you cannot use the Node SDK, verify PineTree webhook signatures manually
using standard HMAC-SHA256.

## Headers sent with every delivery

| Header | Value |
|---|---|
| `PineTree-Signature` | `sha256=<hmac-sha256-hex>` |
| `PineTree-Timestamp` | ISO-8601 timestamp of the event |
| `PineTree-Event-Id` | Unique event identifier for deduplication |
| `PineTree-Event-Schema` | `payments-v1` |

`PineTree-Webhook-Version` is also sent as a legacy alias for `PineTree-Event-Schema`.

## Verification algorithm

1. Read the raw request body **before** any JSON parsing.
2. Extract `PineTree-Signature` (format: `sha256=<hex>`) and `PineTree-Timestamp`.
3. Reject events with a timestamp older than 5 minutes.
4. Compute `HMAC-SHA256(key=webhookSecret, message=PineTree-Timestamp + "." + rawBody)` and hex-encode it.
5. Use a timing-safe comparison to compare the computed hex with the header value (strip the `sha256=` prefix first).
6. If they match, parse the body as JSON and process the event.

## Node.js (no SDK)

```typescript
import { createHmac, timingSafeEqual } from "node:crypto"
import express from "express"

const app = express()
const WEBHOOK_SECRET = process.env.PINETREE_WEBHOOK_SECRET!
const REPLAY_WINDOW_SECONDS = 300

app.post(
  "/webhooks/pinetree",
  express.raw({ type: "*/*" }),
  (req, res) => {
    const signatureHeader = req.headers["pinetree-signature"] as string
    const timestampHeader = req.headers["pinetree-timestamp"] as string

    if (!signatureHeader || !timestampHeader) {
      return res.status(400).send("Missing signature headers")
    }

    // Reject stale events
    const age =
      (Date.now() - new Date(timestampHeader).getTime()) / 1000
    if (Math.abs(age) > REPLAY_WINDOW_SECONDS) {
      return res.status(400).send("Webhook timestamp is stale")
    }

    // Compute expected HMAC
    const expected = createHmac("sha256", WEBHOOK_SECRET)
      .update(`${timestampHeader}.`)
      .update(req.body)
      .digest("hex")

    // Strip "sha256=" prefix from header value
    const actual = signatureHeader.replace(/^sha256=/i, "").trim()

    // Timing-safe comparison
    const expectedBuf = Buffer.from(expected, "hex")
    const actualBuf = Buffer.from(actual, "hex")
    const valid =
      actual.length === expected.length &&
      actualBuf.length === expectedBuf.length &&
      timingSafeEqual(actualBuf, expectedBuf)

    if (!valid) {
      return res.status(400).send("Signature mismatch")
    }

    const event = JSON.parse(req.body.toString("utf8"))

    switch (event.type) {
      case "checkout.session.completed":
        // Fulfill order
        break
      case "checkout.session.expired":
        // Mark as expired
        break
    }

    res.status(200).end()
  }
)
```

## Python

```python
import hashlib
import hmac
import json
import time
from flask import Flask, request, abort

app = Flask(__name__)
WEBHOOK_SECRET = os.environ["PINETREE_WEBHOOK_SECRET"]
REPLAY_WINDOW_SECONDS = 300

@app.route("/webhooks/pinetree", methods=["POST"])
def handle_pinetree_webhook():
    signature_header = request.headers.get("PineTree-Signature", "")
    timestamp_header = request.headers.get("PineTree-Timestamp", "")

    if not signature_header or not timestamp_header:
        abort(400, "Missing signature headers")

    # Reject stale events
    try:
        event_time = datetime.fromisoformat(timestamp_header.replace("Z", "+00:00"))
        age = abs((datetime.now(timezone.utc) - event_time).total_seconds())
    except ValueError:
        abort(400, "Invalid timestamp")
    if age > REPLAY_WINDOW_SECONDS:
        abort(400, "Webhook timestamp is stale")

    # Strip "sha256=" prefix
    actual = signature_header.removeprefix("sha256=")

    # Compute expected HMAC
    expected = hmac.new(
        WEBHOOK_SECRET.encode("utf-8"),
        timestamp_header.encode("utf-8") + b"." + request.data,
        hashlib.sha256,
    ).hexdigest()

    # Timing-safe comparison
    if not hmac.compare_digest(actual, expected):
        abort(400, "Signature mismatch")

    event = request.get_json()

    match event.get("type"):
        case "checkout.session.completed":
            pass  # fulfill order
        case "checkout.session.expired":
            pass  # mark as expired

    return "", 200
```

## PHP

```php
<?php

$WEBHOOK_SECRET = $_ENV['PINETREE_WEBHOOK_SECRET'];
$REPLAY_WINDOW  = 300;

$rawBody          = file_get_contents('php://input');
$signatureHeader  = $_SERVER['HTTP_PINETREE_SIGNATURE'] ?? '';
$timestampHeader  = $_SERVER['HTTP_PINETREE_TIMESTAMP'] ?? '';

if (!$signatureHeader || !$timestampHeader) {
    http_response_code(400);
    exit('Missing signature headers');
}

// Reject stale events
$age = abs(time() - strtotime($timestampHeader));
if ($age > $REPLAY_WINDOW) {
    http_response_code(400);
    exit('Webhook timestamp is stale');
}

// Strip "sha256=" prefix
$actual   = preg_replace('/^sha256=/i', '', $signatureHeader);
$expected = hash_hmac('sha256', $rawBody, $WEBHOOK_SECRET);

if (!hash_equals($expected, $actual)) {
    http_response_code(400);
    exit('Signature mismatch');
}

$event = json_decode($rawBody, true);

switch ($event['type']) {
    case 'checkout.session.completed':
        // fulfill order
        break;
    case 'checkout.session.expired':
        // mark as expired
        break;
}

http_response_code(200);
```

## Event payload shape

```json
{
  "eventId":   "evt_01j...",
  "object":    "event",
  "type":      "checkout.session.completed",
  "createdAt": "2026-06-12T12:00:00.000Z",
  "data": {
    "object": {
      "id": "cs_01j...",
      "object": "checkout.session",
      "status": "paid",
      "amount": 2500,
      "currency": "USD",
      "reference": "order_abc123",
      "paymentId": "pay_01j...",
      ...
    }
  }
}
```

## Event types

| Event type | Trigger |
|---|---|
| `checkout.session.created` | Session was created |
| `checkout.session.completed` | Payment completed |
| `checkout.session.failed` | Payment attempt failed |
| `checkout.session.expired` | Session expired without payment |
| `checkout.session.canceled` | Session was canceled by the merchant |

## Security notes

- **Always use timing-safe comparison** (`timingSafeEqual`, `hmac.compare_digest`,
  `hash_equals`). String equality is vulnerable to timing attacks.
- **Always read the raw body before JSON parsing.** Whitespace normalization
  or key reordering will change the HMAC.
- **Reject events outside the replay window.** The default is 5 minutes; adjust
  to suit your latency requirements.
- **Deduplicate on `eventId`** — PineTree may deliver the same event more than
  once under failure conditions.
