# Bitcoin platform fee settlement (Speed application_fee)

## Confirmed contract (2026-07-23)

Speed's official Custom Connect API Documentation (`POST /payments`) confirms:

- `application_fee` is a **fixed amount in the payment's own `currency`**
  (USD for PineTree) - **never** converted to sats, regardless of
  `target_currency` being `"SATS"`.
- `application_fee_percentage` is a separate, optional percentage-based fee.
  PineTree's platform fee is fixed ($0.15/transaction, `PINETREE_FEE` in
  `engine/config.ts`), so `application_fee_percentage` is never sent.
- The connected account a payment is created for is scoped via the
  `speed-account` HTTP request header (not a body field) - confirmed
  separately by Speed's Vivek (Speed <> PineTree channel, 2026-07-17): "Just
  like 'payments' and 'instant send' APIs you need to pass connected account
  id in 'speed-account' header field." This was already implemented correctly
  in `speedRequestWithStatus` (`providers/lightning/speedClient.ts`) and was
  never the source of the regression below.

`createSpeedLightningPayment` now sends `application_fee: <USD amount>` on
every connect-split Bitcoin payment (never on treasury-sweep payments, which
route the full gross amount to PineTree's own platform account directly and
have no connected-account split to fee against).

## History - two failed unit assumptions, in production, back to back

1. **Raw USD float** (`application_fee: 0.15`): produced a zero-value
   "Application Fee In" record in Speed's dashboard. In hindsight this was
   very likely a different bug (a stale merchant Speed account or an earlier
   request-shape issue), not proof the unit itself was wrong - the official
   documentation shows this exact float format working end-to-end.
2. **Pre-converted whole satoshis** (`application_fee: 225` or similar,
   derived from the live BTC/USD rate via `lib/bitcoin/feeConversion.ts`):
   Speed's `POST /payments` **rejected this outright with an HTTP 400**,
   breaking Bitcoin Lightning payment creation entirely in production. This
   was the correct diagnosis: satoshis are the wrong unit for
   `application_fee`. Sats are only ever `target_currency`/`target_amount` -
   not the fee.

Both attempts were guesses at Speed's unit contract, made without the
official documentation in hand. The documentation resolves this: unit #1's
format (USD float) was correct all along; only the concurrent removal of
`application_fee` entirely (to unblock production) was the over-correction,
and it is now reverted.

## What actually happens today

- `createSpeedLightningPayment` includes `application_fee: pineTreeFeeAmount`
  (raw USD, e.g. `0.15`) in the request body whenever a connect-split fee
  applies (`!useTreasurySweep && pineTreeFeeAmount > 0`). Never
  `application_fee_percentage`. Never both.
- `pineTreeFeeSats`/`btcPriceUsdAtFeeQuote` are still computed/persisted
  best-effort (a missing/invalid BTC price is logged and simply omitted,
  never a thrown error) purely for PineTree's own display/reconciliation -
  they are never sent to Speed in any field.
- `SpeedFeeSettlementStatus` (`providers/lightning/speedClient.ts`) now has 5
  honest states: `"not_applicable"` (no fee owed), `"retained_pending_sweep"`
  (treasury-sweep mode - no Speed-side split), `"transfer_created"` (the
  create-payment response confirmed a planned `APPLICATION_FEE` transfer -
  Speed's documented example shows this even while `status: "unpaid"`),
  `"missing"` (a fee was expected but no transfer evidence was found), and
  `"settled"` (a paid webhook/retrieval confirmed a *realized*
  `APPLICATION_FEE` transfer - i.e. one carrying a `transfer_id`, which Speed
  only includes post-settlement). **There is no `"credited"`/`"collected"`
  state** - "settled" only ever comes from a `transfer_id`, never inferred
  from the payment merely being paid.

## Where "settled" gets set

`engine/speedFeeSettlement.ts` (`recordSpeedApplicationFeeSettlement`) is the
only place that writes `"settled"`. It is called from both places a
payment.paid event can be observed:

- `engine/eventProcessor.ts`'s `processWebhook`, using the raw webhook
  payload's `data.object.transfers[]`.
- `engine/lightningSpeedReconciliation.ts`'s `reconcileSpeedLightningPayment`,
  using the `transfers[]` from a `GET /payments/:id` retrieval (the polling
  path used when no webhook has arrived yet).

Both call sites already guard on the payment's terminal status before
reaching this point (a redelivered/duplicate `payment.paid` webhook cannot
re-enter), and `recordSpeedApplicationFeeSettlement` independently only acts
on payments whose recorded status is `"transfer_created"` or `"missing"` -
never `"not_applicable"`/`"retained_pending_sweep"`/`"settled"` - so it can
never downgrade an already-settled record or act on a payment that never
expected a fee.

## Treasury vs merchant account routing (unchanged)

- **Merchant Speed sub-account** (`merchant_lightning_profiles.speed_account_id`
  / `speed_connected_account_relationship_id`, resolved via
  `resolveSpeedHeaderAccountId`): scoped via the `speed-account` HTTP header
  on the invoice-creation request. This is where the *gross* customer payment
  settles.
- **PineTree treasury/platform account**: the account that owns
  `SPEED_API_KEY`. `application_fee` transfers to this account automatically,
  per Speed's Custom Connect model - there is no separate "destination"
  parameter in the request payload; Speed determines the platform account
  from the API key making the request.
- `SPEED_PLATFORM_ACCOUNT_ID` exists in configuration only for
  diagnostics/config-status reporting (`getPineTreeSpeedConfigStatus`) - not
  wired into any request as a routing destination.

## Speed POST /payments 400 diagnostics

A payment-creation failure is logged as `[speed] bitcoin_payment_create_failed`
with: canonical transaction id, HTTP status, Speed's provider code, the
sanitized field-error message, request id, operation (`payment.create`),
settlement mode, whether `application_fee` was present and its value,
confirmation that `application_fee_percentage` is never present, whether the
`speed-account` header was present, the inferred API environment
(test/live), invoice currency, target currency, and a masked (suffix-only)
merchant Speed account identifier. Never the API key, the full account id, or
the Authorization header value. This is in addition to the pre-existing
generic `[speed] API request failed` log that covers every Speed endpoint.

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
predate this fix and must not be mutated retroactively. No retroactive
merchant debit should be attempted without explicit finance/ops review.
