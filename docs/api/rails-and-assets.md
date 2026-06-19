# Rails and Assets

A **rail** is the payment network or provider path PineTree can route through. An **asset** is what the customer pays on that rail.

Checkout session creation restricts rails. It does not preselect a specific asset unless a checkout UI flow later passes a supported network/asset selection.

## Supported checkout session rails

| Rail | Description | Assets offered |
|---|---|---|
| `solana` | Solana network rail | SOL on Solana, USDC on Solana |
| `base` | Base network rail | ETH on Base, USDC on Base |
| `bitcoin_lightning` | Bitcoin Lightning rail | BTC over Lightning |
| `shift4` | Card processing rail | Card/USD through Shift4 where enabled |

The implementation also accepts `lightning`, `btc_lightning`, and `lightning_btc` as aliases that normalize to `bitcoin_lightning`.

## Hosted checkout network and asset selection

The hosted checkout select-network flow uses these combinations:

| Network | Asset |
|---|---|
| `solana` | `SOL` |
| `solana` | `USDC` |
| `base` | `ETH` |
| `base` | `USDC` |
| `bitcoin_lightning` | `BTC` |

Card payments use the `shift4` rail and settle in USD where Shift4 is enabled for the merchant.

## Invalid rail examples

These are not supported checkout session rail identifiers:

| Invalid value | Use instead |
|---|---|
| `sol` | `solana` |
| `base-usdc` | `base` |
| `solana_usdc` | `solana` |
| `base_usdc` | `base` |
| `base_eth` | `base` |

Use rail identifiers in the `rails` array:

```json
{
  "amount": 2600,
  "currency": "USD",
  "rails": ["solana", "base", "bitcoin_lightning"]
}
```

Passing `rails: ["solana"]` allows Solana payment options such as SOL on Solana and USDC on Solana. It does not mean "SOL only".
