# Bitcoin platform fee settlement (Speed application_fee)

## Confirmed contract (2026-07-23, corrected same day - see "History" below)

- `application_fee` is denominated in the payment's `target_currency`
  (always `"SATS"` for PineTree Lightning payments) - **not** the payment's
  own `currency` (USD). This is confirmed empirically, not from Speed's
  documentation (see the third History entry below): a full chronological
  replay of PineTree's live platform Speed `/balance-transactions` ledger
  reproduced the live `/balances` figure to 14 significant digits when every
  `"Application Fee In"`/`"Application Fee Out"` row's `net` value was
  treated as already-in-sats.
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

`createSpeedLightningPayment` now sends `application_fee: <integer sats>` on
every connect-split Bitcoin payment (never on treasury-sweep payments, which
route the full gross amount to PineTree's own platform account directly and
have no connected-account split to fee against), and only when a valid
positive-integer sats quote is available - if the BTC/USD price feed was
unavailable at invoice-creation time, the platform fee is skipped for that
one payment (logged as `bitcoin_platform_fee_skipped_missing_sats_quote`)
rather than ever sent as a broken value. Bitcoin payment creation itself is
never blocked by this.

## History - two failed unit assumptions, in production, back to back

1. **Raw USD float** (`application_fee: 0.15`): produced a zero-value
   "Application Fee In" record in Speed's dashboard. In hindsight this was
   very likely a different bug (a stale merchant Speed account or an earlier
   request-shape issue), not proof the unit itself was wrong - the official
   documentation shows this exact float format working end-to-end.
2. **Pre-converted whole satoshis** (`application_fee: 225` or similar,
   derived from the live BTC/USD rate via `lib/bitcoin/feeConversion.ts`):
   Speed's `POST /payments` **rejected this outright with an HTTP 400** at
   the time. In hindsight (see #3 below) this was very likely a malformed
   float-precision `amount` field colliding with this attempt, not proof
   sats were the wrong unit for `application_fee` - the two bugs shipped
   close together and were never isolated from each other at the time.
3. **USD float, "confirmed against official documentation"** (2026-07-23,
   same day as #1/#2): re-added `application_fee: <USD amount>` (e.g.
   `0.15`) based on a reading of Speed's Custom Connect API Documentation.
   Speed's `POST /payments` accepted this with a 200 and even echoed back a
   `transfers[]` entry with `created_type: "APPLICATION_FEE"` - which is
   exactly why this looked confirmed. It wasn't: live ledger reconciliation
   the same day proved Speed silently interpreted `0.15` as **0.15
   satoshis**, not $0.15. A fixed USD float is the wrong unit; `POST
   /payments` simply doesn't reject it the way it rejected #2, so the bug
   was invisible until the platform account's actual spendable balance was
   checked against its own transaction ledger.

Three attempts, three different failure modes: #1 silently under-collected
(same underlying bug as #3, never proven at the time), #2 broke checkout
outright, #3 silently under-collected by roughly three orders of magnitude
while looking fully correct in every request/response log. None of them were
caught by unit tests, because every test asserted the request shape PineTree
*intended* to send, never cross-checked against Speed's actual realized
ledger balance. The only test that would have caught this is exactly the
kind added in `__tests__/bitcoinFeeSettlement.test.ts` for the corrected
sats-based behavior: asserting the literal wire value, not just its
presence.

## What actually happens today

- `createSpeedLightningPayment` includes `application_fee: platformFeeSats`
  (integer satoshis, e.g. `232` for a $0.15 fee at ~$64,708/BTC) in the
  request body whenever a connect-split fee is owed
  (`!useTreasurySweep && pineTreeFeeAmount > 0`) **and** a valid
  positive-integer sats quote is available. Never `application_fee_percentage`.
  Never both. Never a raw USD float.
- `pineTreeFeeSats`/`btcPriceUsdAtFeeQuote` (computed via
  `lib/bitcoin/feeConversion.ts#convertUsdFeeToSats` - always rounds up,
  never collapses a nonzero fee to 0 sats) are still best-effort at the
  invoice-creation call site (`providers/lightning/speedAdapter.ts`): a
  missing/invalid BTC price is logged and the value stays `undefined`,
  Bitcoin payment creation is never blocked. `createSpeedLightningPayment`
  itself is the fail-safe boundary - if a fee is owed but no valid sats
  quote arrived, it skips `application_fee` entirely for that one request
  (logged as `bitcoin_platform_fee_skipped_missing_sats_quote`) rather than
  ever sending a broken value.
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
  `SPEED_API_KEY`. `application_fee` (integer sats) transfers to this
  account automatically, per Speed's Custom Connect model - there is no
  separate "destination" parameter in the request payload; Speed determines
  the platform account from the API key making the request. Confirmed live
  (2026-07-23): this account's `/balance-transactions` ledger shows a
  matched `"Application Fee In"` credit for every merchant-side
  `"Application Fee Out"` debit, ~500ms apart, and its registered webhooks
  (`livemode: true`, active, pointed at `app.pinetree-payments.com`) confirm
  it is genuinely PineTree's production account, not a mislabeled connected
  account.
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

## Under-collected fees from the USD-float regression (2026-07-23)

Every connect-split Lightning payment created between the USD-float
regression shipping and this fix collected the platform fee as 0.15
satoshis instead of the intended ~232 satoshis ($0.15) - confirmed by direct
comparison of PineTree's `payments.metadata.pineTreeFeeAmount` (the intended
USD fee) against the live Speed platform ledger's realized
`Application Fee In` amount for the same `transfer_id`. These payments are
**not** retroactively re-debited by this fix - `merchant_lightning_profiles`/
`payments` records are left as-is. Any retroactive collection of the
shortfall from already-settled merchant payments requires explicit
finance/ops review and is out of scope here, per the same policy as the
pre-existing zero-value records above.
