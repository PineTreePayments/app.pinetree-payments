# Provider Integrations

Provider integrations are internal PineTree-to-provider connections. They are not merchant-facing public API endpoints.

Implemented provider webhook route families include:

| Path | Classification | Notes |
|---|---|---|
| `/api/webhooks/base` | Provider webhook | Base network/provider callbacks. |
| `/api/webhooks/lightning` | Provider webhook | Lightning callbacks. |
| `/api/webhooks/moonpay/off-ramp` | Provider webhook | MoonPay off-ramp callbacks. |
| `/api/webhooks/provider` | Provider webhook | Generic provider callback. |
| `/api/webhooks/solana` | Provider webhook | Solana payment callbacks. |
| `/api/webhooks/speed` | Provider webhook | Speed Lightning callbacks. |

Merchant webhooks are configured in the dashboard and documented in [Webhooks](./webhooks.md).
