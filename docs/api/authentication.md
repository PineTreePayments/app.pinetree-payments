# Authentication

PineTree uses API keys for server-to-server authentication. There are two key types: secret API keys for server use, and public browser keys for client-side use. They serve different purposes and must never be mixed.

---

## Secret API Keys

Secret API keys authenticate server requests to the PineTree API. PineTree API uses versioned REST endpoints. The current API path prefix is `/api/v1`. Keys are created in the **Developer → API Keys** section of your dashboard.

**Format:** `pt_live_<64 hex characters>`

**Example:** `pt_live_a3f9b2c1d4e5...` (64 hex chars)

Secret keys must only be used on your server. They provide access to your merchant account including session creation, payment retrieval, and webhook management.

---

## Authorization Header

All REST API requests require the key in the `Authorization` header:

```http
Authorization: Bearer pt_live_your_api_key_here
Content-Type: application/json
```

---

## Public Browser Keys

Public browser keys authenticate requests from browser code. They are used with the `@pinetreepayments/js` and `@pinetreepayments/react` SDKs.

**Format:** `pk_live_<...>`

Public keys are passed via the `X-PineTree-Public-Key` header (handled automatically by the SDK). They can only create new checkout sessions — they cannot read payments, manage webhooks, or access any private merchant data.

**Safe to embed in front-end code.** Cannot access private merchant data.

---

## API Key Permissions

Each API key has a set of permissions. You can create keys with only the permissions your integration needs.

| Permission | Grants |
|------------|--------|
| `checkout.sessions:create` | Create checkout sessions (`POST /api/v1/checkout/sessions`) |
| `checkout.sessions:read` | List and retrieve checkout sessions |
| `payments:read` | Retrieve payment objects |
| `webhooks:read` | List webhook deliveries |
| `webhooks:write` | Retry webhook deliveries |

A key with `checkout.sessions:create` but not `checkout.sessions:read` can create sessions but cannot list or retrieve them. Scope keys narrowly to reduce the impact of a leaked key.

---

## Missing Key

If no `Authorization` header is provided:

```http
HTTP/1.1 401 Unauthorized

{
  "error": {
    "type": "authentication_error",
    "code": "missing_api_key",
    "message": "A PineTree API key is required."
  }
}
```

---

## Invalid Key Format

If the key does not start with `pt_live_`:

```http
HTTP/1.1 401 Unauthorized

{
  "error": {
    "type": "authentication_error",
    "code": "invalid_api_key",
    "message": "The provided API key is invalid."
  }
}
```

---

## Revoked or Nonexistent Key

If the key format is valid but the key does not exist in the database or has been revoked:

```http
HTTP/1.1 401 Unauthorized

{
  "error": {
    "type": "authentication_error",
    "code": "invalid_api_key",
    "message": "The provided API key is invalid or revoked."
  }
}
```

---

## Insufficient Permission

If the key exists but lacks the required permission for the requested endpoint:

```http
HTTP/1.1 403 Forbidden

{
  "error": {
    "type": "authorization_error",
    "code": "missing_permission",
    "message": "The API key requires the checkout.sessions:read permission."
  }
}
```

---

## Auth Surface Comparison

| Auth Method | Used By | Secret? | Scope |
|-------------|---------|---------|-------|
| `pt_live_*` API key | Your server | Yes — keep secret | REST API |
| `pk_live_*` public key | Browser / frontend | No — safe to expose | Browser checkout sessions only |
| Webhook signing secret (`whsec_*`) | Your webhook handler | Yes — keep secret | Webhook verification only |
| Supabase JWT | Dashboard browser session | Cookie-scoped | Dashboard routes only |
| Terminal session token (`pts_*`) | PineTree POS terminal | Device-scoped | POS routes only |

---

## Security Best Practices

1. **Never expose secret keys in browser code.** Use environment variables on the server. Use `pk_live_*` public keys for browser code.
2. **Rotate keys if compromised.** Create a new key, update your environment variables, then revoke the old key.
3. **Scope keys narrowly.** A key for order fulfillment only needs `payments:read`. A key for checkout creation only needs `checkout.sessions:create`.
4. **Store keys in environment variables**, not in source code or config files.
5. **Verify webhook signatures** on every incoming event. Do not trust events without a valid `PineTree-Signature` header. See [Webhooks](./webhooks.md).
6. **Use HTTPS** for all webhook endpoints. PineTree will not deliver events to plaintext HTTP endpoints in production.
