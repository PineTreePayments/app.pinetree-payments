# API Keys

PineTree has two key types.

| Key | Prefix | Use | Public? |
|---|---|---|---|
| Secret API key | `pt_live_` | Server-side REST API calls | No |
| Browser public key | `pk_live_` | Browser SDK checkout creation | Yes |

Secret keys are sent as bearer tokens:

```http
Authorization: Bearer pt_live_...
```

Browser public keys are sent by the browser SDK:

```http
X-PineTree-Public-Key: pk_live_...
```

## Permissions

| Permission | Grants |
|---|---|
| `checkout.sessions:create` | Create checkout sessions. |
| `checkout.sessions:read` | List and retrieve checkout sessions. |
| `checkout.sessions:write` | Cancel or expire checkout sessions. |
| `payments:read` | Retrieve payment objects. |
| `webhooks:read` | List webhook deliveries. |
| `webhooks:write` | Retry webhook deliveries. |

Use the narrowest key that can perform the job.
