# Payment Intents

Payment intent APIs are internal hosted-checkout runtime APIs, not public developer REST endpoints.

Implemented routes:

| Method | Path | Classification | Purpose |
|---|---|---|---|
| `GET` | `/api/payment-intents/{intentId}` | Internal checkout | Read a runtime payment intent. |
| `POST` | `/api/payment-intents/{intentId}/select-network` | Internal checkout | Select a network/asset for hosted checkout. |
| `POST` | `/api/payment-intents/{intentId}/cancel` | Internal checkout | Cancel a runtime intent. |

Hosted checkout uses the following network/asset pairs:

| Network | Asset |
|---|---|
| `solana` | `SOL` |
| `solana` | `USDC` |
| `base` | `ETH` |
| `base` | `USDC` |
| `bitcoin_lightning` | `BTC` |

For public server integrations, create a checkout session through `POST /api/v1/checkout/sessions` and redirect the customer to `checkoutUrl`.
