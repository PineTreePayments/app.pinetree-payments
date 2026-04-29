# Solana Pay Skill

## Core Rule
Wallet button = trigger everything.

## Flow
intent → select asset → select wallet → create payment (PENDING) → open wallet deep link → wallet GET → wallet POST → backend builds tx → user approves → watcher confirms

## UI Rules
- Show explicit wallet buttons only (Phantom, Solflare)
- Each button opens its own wallet-specific deep link
- NEVER open raw paymentUrl directly
- NEVER use the solana: URI scheme in mobile checkout (iOS routes it to whichever app claims the scheme — not necessarily Phantom)
- NEVER use QR in mobile checkout
- NEVER detect or auto-select wallets

## Payment Rules
- NO payment before wallet click
- Create payment ONLY on wallet click
- Status starts as PENDING

## Deep Links (Mobile Checkout)
Wallet-specific deep links MUST be used in mobile checkout. They route to the correct app and pass the Solana Pay transaction request URL as the payload:

- Phantom:  `phantom://ul/v1/pay?link=${encodeURIComponent(paymentUrl)}`
- Solflare: `solflare://ul/v1/pay?link=${encodeURIComponent(paymentUrl)}`

The `paymentUrl` passed as `link=` is the Solana Pay transaction request endpoint. Phantom and Solflare execute the GET → POST protocol against it.

## solana: URI (Spec Reference Only)
The `solana:<encoded_url>` scheme is the Solana Pay protocol-level format. It is NOT used in PineTree mobile checkout because iOS presents an app disambiguation sheet when multiple wallets are installed, which breaks wallet-specific routing.

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
- solana: URI in mobile checkout
