# Solana Pay Skill

## Core Rule
Wallet button = trigger everything.

## Flow
intent → select asset → select wallet → create payment (PENDING) → open solana: URI → wallet GET → wallet POST → backend builds tx → user approves → watcher confirms

## UI Rules
- Show explicit wallet buttons only (Phantom, Solflare)
- Each button opens the Solana Pay transaction request URI
- NEVER open raw paymentUrl directly
- NEVER use QR in mobile checkout
- NEVER detect or auto-select wallets

## Payment Rules
- NO payment before wallet click
- Create payment ONLY on wallet click
- Status starts as PENDING

## Transaction Request URI
Solana Pay transaction request format MUST be:

  solana:<absolute_https_transaction_request_url>

If paymentUrl contains query params, encode the full URL:

  const solanaPayUrl = `solana:${encodeURIComponent(paymentUrl)}`

- Wallet buttons may be labeled Phantom and Solflare, but the URI is wallet-standard
- Do NOT use phantom://ul/v1/pay?link=...
- Do NOT use solflare://ul/v1/pay?link=...
- Do NOT open raw paymentUrl directly

## URL Rules
- paymentUrl MUST be absolute https://.../api/solana-pay/transaction?paymentId=...
- NEVER relative (/api/...)
- solana: prefix is the correct outer wrapper — encode the full https:// URL inside it

## Backend Rules
- Transaction built ONLY on POST
- Return base64 serialized tx
- Include blockhash, fee payer, instructions

## Forbidden
- wallet adapter (useWallet, sendTransaction)
- UI transaction logic
- QR fallback
- preloading sessions
