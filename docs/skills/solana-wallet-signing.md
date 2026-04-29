# Solana Wallet Signing Skill

## Core Rule
Wallet-specific Solana checkout uses wallet browser flow, not Solana Pay and not deeplink signing.

## Flow
wallet click → resolve/create payment → open checkout URL inside Phantom browser → wallet-native signing

## UI Rules
- UI resolves paymentId on wallet button click only — never before
- UI opens wallet browser deeplink with checkout URL + payment context in params
- UI must not construct transaction instructions
- UI must not calculate fees
- UI must not update payment status

## Backend Rules
- Engine builds transaction
- Engine owns fee split
- Engine validates paymentId, merchant wallet, treasury wallet, amount
- Backend broadcasts signed transaction or records tx hash

## Phantom Browser Deeplink
```
phantom://browse/<url-encoded-checkout-url>
```
Checkout URL params carried through:
- `pinetree_payment_id` — resolved payment ID
- `wallet` — `phantom`
- `mode` — `wallet-browser`

## Forbidden
- Solana Pay `solana:` URI for wallet-specific checkout
- `phantom://ul/v1/pay?link`
- `phantom://ul/v1/connect` — requires encrypted session (nonce, dapp key, callback)
- `phantom://ul/v1/signTransaction` — requires encrypted session
- QR fallback
- UI transaction construction
