# Bitcoin platform fee settlement (Speed application_fee)

## What this covers

PineTree's $0.15/transaction platform fee (`PINETREE_FEE`, `engine/config.ts`)
for Bitcoin Lightning payments routed through Speed's merchant-connected-account
path (`PINE_TREE_LIGHTNING_SETTLEMENT_MODE=speed_merchant_account`, the
`speed_connect_split` code path in `providers/lightning/speedAdapter.ts` /
`providers/lightning/speedClient.ts`).

## Root cause of the zero-value "Application Fee In" records

Speed's `/payments` invoice for this flow is created with
`target_currency: "SATS"`. The fee was previously sent to Speed's
`application_fee` field as a **raw USD float** (e.g. the literal number
`0.15`), with no unit conversion. Speed silently interpreted this as
"0.15 sats", which rounds/truncates to zero - Speed still created the fee
ledger record (the field was present), but every amount on it was zero.

**Fix**: `application_fee` is now always the fee pre-converted to whole
satoshis (`lib/bitcoin/feeConversion.ts`'s `convertUsdFeeToSats`, the same
`Math.ceil` + minimum-1-sat rule already used by the NWC Lightning fee path),
computed from the live BTC/USD rate already fetched for the payment
(`engine/createPayment.ts`'s `btcPriceUsd`, now actually threaded through to
Speed instead of being dropped). `providers/lightning/speedClient.ts` fails
closed (throws, does not silently degrade to zero) if a nonzero fee is owed
but no valid sats value was supplied.

## Treasury vs merchant account routing

- **Merchant Speed sub-account** (`merchant_lightning_profiles.speed_account_id`
  / `speed_connected_account_relationship_id`, resolved via
  `resolveSpeedHeaderAccountId`): scoped via the `speed-account` HTTP header
  on the invoice-creation request. This is where the *gross* customer payment
  settles - correct, unchanged by this fix.
- **PineTree treasury/platform account**: the account that owns
  `SPEED_API_KEY`. Speed's `application_fee` field (a Stripe-Connect-style
  mechanism) is what is supposed to automatically slice PineTree's cut into
  this account. There is no separate "destination" parameter for the fee in
  the request payload - the platform API key's own account is the implicit
  destination.
- `SPEED_PLATFORM_ACCOUNT_ID` exists in configuration today only for
  diagnostics/config-status reporting (`getPineTreeSpeedConfigStatus`) - it is
  **not** wired into any request as a routing destination, and this fix does
  not change that.

## Known limitation (documented, not silently worked around)

Speed does not currently expose a documented or modeled way for PineTree to
read back **confirmation that a specific application-fee slice was actually
credited** to the treasury account for a given payment (no confirmed field on
the retrieved payment object, no separate settlement endpoint in this
codebase's Speed client). Because of this:

- `SpeedFeeSettlementStatus` (`providers/lightning/speedClient.ts`)
  intentionally has only three states: `"requested"`, `"retained_pending_sweep"`
  (treasury-sweep mode, where the fee is retained rather than paid out to the
  merchant - no application_fee request is made at all), and
  `"not_applicable"` (no fee owed). **There is no `"credited"` state.** Adding
  one without a real verification mechanism would reproduce the same kind of
  unverified assumption that caused the original defect.
- `engine/lightningSpeedReconciliation.ts` logs the fee-settlement bookkeeping
  (`[speed] bitcoin_fee_reconciliation`) whenever a payment is confirmed, for
  visibility, but never marks a fee "credited" - only what was requested at
  invoice-creation time.
- Reports/ledger surfaces must not display a Bitcoin platform fee as
  "collected" based on this data alone; treat every Speed Lightning payment's
  fee as `requires_reconciliation` (pending manual/finance confirmation, or a
  future code change once Speed's settlement-confirmation contract is
  confirmed) until a verified read-back mechanism exists.

**Do not** attempt to "fix" this by inventing a plausible-looking field on the
retrieved Speed payment object to treat as proof of settlement - that would be
guessing a provider contract exactly the way the original bug was introduced
(see `providers/lightning/speedClient.ts`'s header comment and
[[project_speed_btc_balance_and_bitcoin_withdrawals]] for this codebase's
established norm against guessing Speed's API contract).

## Existing zero-value records already in Speed's dashboard

Historical "Application Fee In" records with `net`/`amount`/`fee` all zero,
created before this fix, are Speed-side provider records - this fix does not
and must not mutate them. They represent invoices where PineTree requested a
fee that could not settle for the reason above (raw-USD-float
misinterpretation). No retroactive merchant debit should be attempted without
explicit finance/ops review - this fix only prevents the defect going forward.
