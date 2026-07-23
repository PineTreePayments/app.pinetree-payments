# Bitcoin platform fee settlement (Speed application_fee)

## Current state (as of the 2026-07-23 urgent restoration)

**`application_fee` is not sent to Speed's `POST /payments` at all**, for any
settlement mode. PineTree's $0.15/transaction platform fee (`PINETREE_FEE`,
`engine/config.ts`) is still calculated and recorded internally
(`platform_fee_usd`, `platform_fee_sats`, `fee_conversion_rate_usd`,
`fee_settlement_status` in the payment's metadata), but is never requested
from Speed until Speed's real `application_fee` contract is confirmed.
Bitcoin Lightning payment creation must never be blocked by fee-conversion
availability or by an unconfirmed provider fee mechanism - see
`providers/lightning/speedClient.ts`'s `createSpeedLightningPayment` and
`providers/lightning/speedAdapter.ts`'s `createLightningInvoice`.

## History - two failed unit assumptions, in production, back to back

1. **Raw USD float** (`application_fee: 0.15`): Speed accepted the request
   (HTTP 200) but created a zero-value "Application Fee In" record - the
   value was silently misinterpreted (most likely as `0.15` of whatever unit
   Speed expects, collapsing to zero).
2. **Pre-converted whole satoshis** (`application_fee: 225` or similar,
   derived from the live BTC/USD rate via `lib/bitcoin/feeConversion.ts`):
   Speed's `POST /payments` **rejected this outright with an HTTP 400**,
   breaking Bitcoin Lightning payment creation entirely in production
   (`select-network` returning 400 for every Bitcoin Lightning selection).

Both attempts were guesses at Speed's unit contract, and both were wrong (or
at least incomplete). **Do not guess a third time.** Do not reintroduce
`application_fee` in any unit without either Speed's official documentation
for this exact field on this exact endpoint, or a confirmed sandbox response
proving the request shape is accepted.

## What actually happens today

- `createSpeedLightningPayment` builds the invoice request body without an
  `application_fee` key at all, regardless of settlement mode.
- `pineTreeFeeSats`/`btcPriceUsdAtFeeQuote` may still be supplied by the
  caller (best-effort; a missing/invalid BTC price is logged and the fields
  are simply omitted, never a thrown error) - if present they are persisted
  in the request's opaque `metadata` object (Speed's own free-form
  pass-through field, unrelated to `application_fee`'s specific semantics)
  purely for PineTree's own future reconciliation once a verified mechanism
  exists.
- `SpeedFeeSettlementStatus` is `"not_collected"` for the normal
  merchant-connected-account path (fee calculated/tracked, never requested
  from Speed), `"retained_pending_sweep"` for treasury-sweep mode (fee
  retained by simply not paying it out - a real, different mechanism, not
  Speed's `application_fee`), or `"not_applicable"` when no fee is owed.
  **There is no `"credited"`/`"collected"` state** - see below.

## Treasury vs merchant account routing (unchanged)

- **Merchant Speed sub-account** (`merchant_lightning_profiles.speed_account_id`
  / `speed_connected_account_relationship_id`, resolved via
  `resolveSpeedHeaderAccountId`): scoped via the `speed-account` HTTP header
  on the invoice-creation request. This is where the *gross* customer payment
  settles - correct, unaffected by any of the fee-related changes above.
- **PineTree treasury/platform account**: the account that owns
  `SPEED_API_KEY`. If/when `application_fee` (or an alternative supported
  mechanism) is re-enabled, this is still the intended fee destination -
  there is no separate "destination" parameter for the fee in the request
  payload today.
- `SPEED_PLATFORM_ACCOUNT_ID` exists in configuration only for
  diagnostics/config-status reporting (`getPineTreeSpeedConfigStatus`) - not
  wired into any request as a routing destination.

## Known limitation (documented, not silently worked around)

Speed does not currently expose a documented or modeled way for PineTree to
read back confirmation that a fee was actually credited to the treasury
account for a given payment. Because of this:

- `SpeedFeeSettlementStatus` intentionally has no `"credited"` state. Adding
  one without a real verification mechanism would reproduce the exact kind of
  unverified assumption that caused both regressions above.
- `engine/lightningSpeedReconciliation.ts` logs the fee-settlement
  bookkeeping (`[speed] bitcoin_fee_reconciliation`) whenever a payment is
  confirmed, for visibility, but never marks a fee "credited."
- Reports/ledger surfaces must not display a Bitcoin platform fee as
  "collected" based on this data alone.

## Speed POST /payments 400 diagnostics

A payment-creation failure is logged as `[speed] bitcoin_payment_create_failed`
with: canonical transaction id, HTTP status, Speed's provider code, the
sanitized field-error message, request id, operation (`payment.create`),
settlement mode, whether `application_fee` was present (now always `false`),
invoice currency, target currency, and a masked (suffix-only) merchant Speed
account identifier. Never the API key or a full account id. This is in
addition to the pre-existing generic `[speed] API request failed` log that
covers every Speed endpoint.

## Stale/permanently-invalid payment.retrieve references

`reconcileSpeedLightningPayment` catches a 404 (`Invalid payment id`) from
`payment.retrieve` distinctly: it logs
`[speed] payment_retrieve_permanently_stale`, flags the canonical PineTree
payment's metadata (`speedRetrieveStale: true`), and returns without
throwing. On every subsequent reconciliation pass, that flag is checked
first and the Speed call is skipped entirely
(`[speed] payment_retrieve_stale_skip`) - so a stale reference is never
polled indefinitely. The canonical PineTree payment record and its status are
left untouched for support review.

## Existing zero-value records already in Speed's dashboard

Historical "Application Fee In" records with `net`/`amount`/`fee` all zero
are Speed-side provider records from the first (raw-USD-float) attempt - this
fix does not and must not mutate them. No retroactive merchant debit should
be attempted without explicit finance/ops review.
