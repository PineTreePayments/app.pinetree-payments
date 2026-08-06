# Solana Wallet Routing (as implemented)

**Classification:** Scoped active — domain reference
**Authority:** Subordinate to
[Standard 05](../standards/05-provider-connectors-events.md) and
[Standard 02](../standards/02-lifecycle-and-merchant-status.md). This document
describes **what the repository currently does**; it does not grant permission to
change it.

## Why this document exists

Two legacy files in [`docs/skills/`](../skills/) each describe a *different*
Solana flow as the only correct one, and each forbids the other's live code path:

| Legacy file | Requires | Forbids |
|---|---|---|
| `docs/skills/solana-pay.md` | `solana:` URI is "REQUIRED for mobile checkout" | "NEVER use wallet-specific deep links"; lists Phantom/Solflare deeplinks under "Forbidden" |
| `docs/skills/solana-wallet-signing.md` | `phantom://browse/<url>` | "Forbidden: Solana Pay `solana:` URI for wallet-specific checkout" |

Both are stale. The implementation is neither of them exclusively: it is a
**per-wallet strategy registry** in which the `solana:` URI and the wallet
deeplinks coexist, each owning a different situation. An agent acting on either
skill file in isolation would delete a working path.

This document records the actual design so that no future reader has to
adjudicate between the two.

## Source of truth

`lib/wallets/paymentAppRegistry.ts` — the `MobileOpenStrategy` union and one
record per wallet. Routing is a **data lookup**, not a chain of conditionals.

```ts
export type MobileOpenStrategy =
  | "solana_uri"
  | "lightning_uri"
  | "wallet_deep_link"
  | "phantom_browser"
  | "solflare_universal"
  | "walletconnect"
  | "invoice_scheme"
  | "none"
```

Each wallet record additionally declares capability flags that the strategy must
stay consistent with — `supportsSolanaProvider`,
`mobileInAppBrowserSolanaSupport`, `supportsWalletConnect`, `railSupport`,
`assetSupport`, `installUrl`.

## Strategies used on the Solana rail

| Strategy | Wallets | Mechanism | Where |
|---|---|---|---|
| `phantom_browser` | Phantom | Reopens the checkout page **inside Phantom's in-app browser**, which injects `window.solana`; signing is then wallet-native. | `buildPhantomWalletBrowserUrl` → `phantom://browse/<encoded url>` at `lib/wallets/solana.ts:412` |
| `solflare_universal` | Solflare | Solflare Universal Link v1 — an encrypted `connect` → `signAndSendTransaction` deeplink protocol over `https://solflare.com/ul/v1/*`. | `lib/solflareDeeplink.ts`, `lib/solflareServer.ts`, routes under `app/api/solflare/` |
| `wallet_deep_link` | Backpack, Glow, Trust, OKX, Exodus, Ledger, and the remaining catalog wallets | A wallet-specific `https://`/`scheme://` link that opens the wallet's in-app browser at the checkout URL. | Per-wallet fields on the registry record |
| `walletconnect` | Coinbase Wallet, MetaMask, Rainbow, Kraken | WalletConnect session rather than a Solana deeplink. | WalletConnect wrapper |
| `none` | wallets with no known mobile path | Desktop/extension only; UI must not offer a mobile launch. | — |

### `solana_uri` is declared but unused by any wallet record

No registry entry currently sets `mobileOpenStrategy: "solana_uri"`. The value
exists in the union and is documented there, but the `solana:` URI is produced
**outside** the per-wallet registry path, in two places:

| Use | Code | Purpose |
|---|---|---|
| QR encoding for Solana payments | `engine/generateSplitPayment.ts` — `qrSource = \`solana:${paymentUrl}\`` then `QRCode.toDataURL` | A scanned QR must carry the Solana Pay protocol URI |
| One generic wallet option | `engine/paymentIntents.ts` — `{ id: "solana-pay", label: "Open Solana Wallet", url: \`solana:${normalizedUrl}\` }` | OS-level handoff when no specific wallet is chosen |

So `solana:` is alive and correct for **QR and generic handoff**, while named
wallet buttons use their per-wallet strategy. That is the distinction neither
legacy skill file captures.

### Phantom has two implemented paths, not one

- `phantom://browse/...` — in-app browser (`phantom_browser`, the registry
  strategy for the checkout button).
- `https://phantom.app/ul/v1/connect` and
  `https://phantom.app/ul/v1/signTransaction` — the encrypted-session deeplink
  protocol in `lib/wallets/phantomDeeplink.ts`, used by the wallet-approval flow
  at `app/wallet-approval/[sessionId]/page.tsx`.

`docs/skills/solana-wallet-signing.md` lists `phantom://ul/v1/signTransaction`
under "Forbidden". The repository implements the `https://phantom.app/ul/v1/*`
equivalent and depends on it. Another reason not to treat that file as authority.

## Consistency checks that already exist

`app/api/debug/solana-wallet-strategy/route.ts` validates registry coherence —
that a resolved `action` agrees with `mobileOpenStrategy`,
`supportsSolanaProvider`, `mobileInAppBrowserSolanaSupport`, and `installUrl`.
`app/api/debug/lightning-wallet-strategy/route.ts` does the equivalent for
Lightning, including asserting the invoice URL scheme matches the registry's
declared strategy.

If you change routing, run these and keep them passing.

## Rules for changing Solana routing

1. **Change the registry record, not the call sites.** Adding a conditional in a
   component to special-case a wallet reintroduces exactly the drift this registry
   removed.
2. **Keep strategy and capability flags consistent.** A `phantom_browser` or
   `wallet_deep_link` strategy implies `mobileInAppBrowserSolanaSupport: true`;
   the debug routes assert this.
3. **Do not delete the `solana:` URI paths** to satisfy
   `docs/skills/solana-wallet-signing.md`, and **do not delete the wallet
   deeplinks** to satisfy `docs/skills/solana-pay.md`. Both are live.
4. Confirmation still requires
   [Standard 05 §6](../standards/05-provider-connectors-events.md#6-rail-specific-confirmation-evidence)
   evidence: a confirmed/finalized signature with the expected recipient, mint,
   and amount, and no execution error. **Opening a wallet, returning from a
   wallet, or a client-side signing success is not confirmation** — see
   [Standard 02 §2](../standards/02-lifecycle-and-merchant-status.md#2-payment-state-machine).
5. The Engine builds the transaction and owns the fee split. The UI never
   constructs instructions, calculates fees, or writes payment status.

## Related

- [Standard 05 — Provider Connector and Event Processing](../standards/05-provider-connectors-events.md)
- [Standard 02 — Lifecycle and Merchant Status](../standards/02-lifecycle-and-merchant-status.md)
- [`docs/skills/README.md`](../skills/README.md) — why the legacy skills are retained but not authoritative
- [`docs/api/rails-and-assets.md`](../api/rails-and-assets.md) — supported rails and assets
