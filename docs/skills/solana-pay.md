# Solana Pay Skill

## Core Rule
Wallet button = trigger everything.

## Flow
intent → select asset → select wallet → create payment (PENDING) → open deep link → wallet POST → backend builds tx → user approves → watcher confirms

## UI Rules
- Show explicit wallet buttons only (Phantom, Solflare)
- Each button opens its own deep link
- NEVER open raw paymentUrl
- NEVER use QR in mobile checkout
- NEVER detect or auto-select wallets

## Payment Rules
- NO payment before wallet click
- Create payment ONLY on wallet click
- Status starts as PENDING

## Deep Links
- Phantom: phantom://ul/v1/pay?link=ENCODED_URL
- Solflare: solflare://ul/v1/pay?link=ENCODED_URL

## URL Rules
- MUST be absolute https://.../api/solana-pay/transaction?paymentId=...
- NEVER relative (/api/...)
- NEVER solana:

## Backend Rules
- Transaction built ONLY on POST
- Return base64 serialized tx
- Include blockhash, fee payer, instructions

## Forbidden
- wallet adapter (useWallet, sendTransaction)
- UI transaction logic
- QR fallback
- preloading sessions