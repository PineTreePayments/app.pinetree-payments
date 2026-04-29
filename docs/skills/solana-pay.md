# Solana Pay Skill

## Core Rule
Wallet button = trigger everything.

## Flow
intent → select asset → select wallet → create payment (PENDING) → open solana: URI → wallet GET → wallet POST → backend builds tx → user approves → watcher confirms

## UI Rules
- Show explicit wallet buttons only (Phantom, Solflare)
- Both buttons trigger the same `solana:` URI — they are visual only
- NEVER open raw paymentUrl directly
- NEVER use wallet-specific deep links (phantom://ul/v1/pay, solflare://ul/v1/pay) — these do NOT execute the GET → POST protocol reliably
- NEVER use QR in mobile checkout
- NEVER detect or auto-select wallets

## Payment Rules
- NO payment before wallet click
- Create payment ONLY on wallet click
- Status starts as PENDING

## URI (Mobile Checkout)
The `solana:` URI scheme is REQUIRED for mobile checkout. It is the only execution path that triggers the Solana Pay GET → POST transaction protocol:

```
window.location.href = `solana:${encodeURIComponent(paymentUrl)}`
```

The `paymentUrl` is the Solana Pay transaction request endpoint (`https://.../api/solana-pay/transaction?paymentId=...`). The wallet executes GET → POST against it.

**iOS behaviour:** iOS may present an app disambiguation sheet when multiple wallets are installed. PineTree does NOT control which wallet opens — this is OS-level routing. Wallet-specific deep links are NOT supported for transaction execution.

## Wallet-Specific Deep Links (NOT SUPPORTED)
`phantom://ul/v1/pay` and `solflare://ul/v1/pay` are NOT used in PineTree. They open the wallet app but do not trigger GET/POST against the transaction endpoint.

## URL Rules
- paymentUrl MUST be absolute https://.../api/solana-pay/transaction?paymentId=...
- NEVER relative (/api/...)
- NEVER hardcoded domain — NEXT_PUBLIC_APP_URL is the only source

## Backend Rules
- Transaction built ONLY on POST
- Return base64 serialized tx
- Include blockhash, fee payer, instructions

## Forbidden
- wallet adapter (useWallet, sendTransaction)
- UI transaction logic
- QR fallback
- preloading sessions
- phantom://ul/v1/pay or solflare://ul/v1/pay deep links
