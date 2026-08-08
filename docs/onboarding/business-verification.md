# PineTree business verification (merchant onboarding)

**PineTree is the product. Wallet, stablecoin-conversion, and settlement
infrastructure is not.**

Merchants complete **one** PineTree onboarding. They never connect, enable,
disable, or manage an infrastructure provider, and no such provider appears on
the Providers page.

---

## The merchant experience

1. Create a PineTree login.
2. Enter business information once (**Settings → Business Profile**).
3. Enter authorized representative details in the same profile.
4. Review and accept PineTree terms and the required service-provider
   disclosure (**review-and-consent step**, shown once the profile is complete).
5. Complete any sensitive compliance step on the provider-hosted page, entered
   from PineTree and returning to PineTree.
6. PineTree provisions wallet infrastructure automatically (Dynamic + Bitcoin),
   as it already did.
7. PineTree submits the permitted information automatically.
8. PineTree tracks verification in the background.
9. The merchant sees one PineTree status; eligible capabilities activate
   automatically after approval.

The merchant enters business information **once**, in the Business Profile,
organized into five sections: **Business**, **Address**, **Operations**,
**Owners**, and **Verification**. The first four are stored. The fifth collects
the tax identifiers, which are **never stored** — see
[Sensitive data](#sensitive-data).

PineTree never answers a compliance question on a merchant's behalf.
`high_risk_activities`, `operates_in_prohibited_countries`,
`conducts_money_services`, `account_purpose`, and `source_of_funds` have no
default and no inferred value; an unanswered one leaves the profile incomplete.
`none_of_the_above` is a real, explicit answer, and selecting it alongside a
declared activity is rejected rather than silently reconciled.

### Merchant-facing status vocabulary

The merchant sees **Business Profile** status only — `Incomplete`,
`Needs attention`, or `Complete` (`engine/businessProfileFields.ts`,
`engine/businessProfile.ts`).

The verification vocabulary below is **internal**. It is the projection
`engine/businessVerification.ts` produces for onboarding orchestration and
administrator diagnostics. It is **not** rendered on any merchant surface, and
raw provider statuses (`kyc_pending`, `under_review`, endorsement names) are
never displayed anywhere:

| Internal status | Meaning |
|---|---|
| Not started | No business information entered yet. |
| In progress | Profile or consent still outstanding, or submission underway. |
| Under review | Submitted; PineTree is processing verification. No action available. |
| Additional information required | One clear action to finish verification. |
| Verified | Approved; eligible wallet/settlement capabilities are active. |
| Temporarily unavailable | Verification cannot run right now. Information is saved. |

PineTree does **not** perform KYB/KYC approval. Copy says PineTree is reviewing
or processing verification; approval authority remains with the regulated
provider, and provider evidence is authoritative.

---

## Where it appears

**There is exactly ONE merchant-facing business identity concept: the PineTree
Business Profile.** Provider verification/KYB is infrastructure state. It is
never presented to merchants as a second application, card, status surface, or
vocabulary.

| Surface | What it shows |
|---|---|
| **Settings → Business Profile** | The **one** merchant-facing card: the profile entry card (status pill, Edit/Complete Profile), the profile modal, and the review-and-consent step. Nothing else. |
| **Every normal merchant dashboard page** | `BusinessProfileWarning`, mounted once in the shared shell (`app/dashboard/layout.tsx`). It renders the shared `BusinessProfileRequirementBanner` — compact, red, full content width — **only** while the Business Profile is not `complete`. |
| **Providers page** | **Nothing.** Reserved for providers merchants consciously connect. |
| **Admin** (`/api/admin/business-verification`) | Full technical diagnostics, including the underlying provider. The merchant warning is not mounted in `/dashboard/admin/**`. |

The warning never obscures balances, wallet actions, withdrawals, or mobile
authorization controls.

### When the warning shows

The authority is `profile_status` from `engine/businessProfile.ts`, computed
from `BUSINESS_PROFILE_REQUIRED_FIELDS` and read through
`GET /api/merchant/business-profile`:

| `profile_status` | Warning |
|---|---|
| `incomplete` — required fields missing | **Shown** |
| `needs_attention` — merchant input explicitly required | **Shown** |
| `complete` | Hidden |
| not yet loaded, or the read failed | Hidden |

Three rules follow, and all are load-bearing:

- **Provider/KYB state is never an input.** Whether an infrastructure partner
  has started, is reviewing, or has approved the merchant does not change
  whether the merchant finished their PineTree Business Profile.
- **A failed read is not an alert.** An unknown status is never treated as
  incomplete. A transient read failure can never turn a completed Business
  Profile back into an incomplete merchant state.
- **It is mounted once.** Individual pages do not render their own copy. A
  previous revision had per-page banners *and* a shell-mounted warning, which
  showed the same red message twice.

`BusinessProfileRequirementBanner` remains the presentational banner and is
still the single place its markup and deep link live.

---

## Architecture

```
Interface
  → PineTree API            (/api/onboarding/business-verification/*)
  → PineTree Engine         (engine/businessVerification.ts)
  → Bridge provider adapter (providers/bridge/*)
  → Bridge API
  → PineTree database / event processing
```

The UI never imports provider internals and never calls a provider directly.
Merchant surfaces call **PineTree-domain** endpoints only.

**PineTree Engine owns:** the onboarding workflow, the merchant-facing
projection, eligibility, wallet readiness, capability activation, audit events,
and recovery/synchronization.

**The provider owns:** customer identity, KYB/KYC requirements, endorsements,
and approval/rejection/pause/review status.

### API

| Route | Purpose |
|---|---|
| `GET /api/onboarding/business-verification` | Status projection + terms disclosure. Fast, database-only. |
| `POST .../consent` | Record terms acceptance. **Gates all provider submission.** |
| `POST .../continue` | Single-use hosted URL: the provider's own terms step when it still needs one, otherwise the remaining hosted compliance step. |
| `POST .../agreement` | Capture the `signed_agreement_id` the provider returns with the merchant's browser. **Not approval** — it only records which agreement authorizes the submission. |
| `POST .../refresh` | Authoritative provider lookup + automatic activation. |
| `POST /api/webhooks/bridge` | Raw-body signature verification, dedup, ordering. Categories: `customer`, `kyc_link`, `external_account`, `liquidation_address.drain`. |
| `GET|PATCH /api/admin/business-verification` | Admin diagnostics and rollout hold. |
| `POST /api/admin/business-verification/simulate-approval` | **Sandbox only, admin only.** Simulates KYB approval so PineTree can exercise the merchant journey. Refused in production server-side. |

Merchant API keys are rejected (403) on every verification route: no approved
scope exists for accepting legal terms or advancing regulated verification on a
business's behalf.

---

## Consent

PineTree creates **no** provider customer until the merchant accepts the current
terms version. Acceptance is recorded append-only in
`merchant_service_terms_acceptances` with the terms version, disclosed
providers, actor user id, merchant id, timestamp, and request metadata.

- Bumping `CURRENT_SERVICE_TERMS_VERSION` invalidates prior consent.
- An acceptance that did not disclose a provider is **not** consent for it.
- The client echoes the version it displayed; the Engine refuses anything else.
- Consent can never be backfilled by a migration.

Bridge is named in this disclosure because it is the required provider
disclosure — one of the only merchant-facing places the name appears.

---

## Automatic submission and activation

Submission triggers when **all** hold: merchant exists, membership valid,
required profile fields complete, representative details complete, current
terms accepted, provider configured, and no customer already exists.

Activation is a pure consequence of approval — there is no merchant decision:

```
approved + no administrator hold + rollout enabled  →  capability active
```

- Merchants cannot activate early or deactivate.
- Loss of approval immediately deactivates.
- `BRIDGE_CAPABILITY_ROLLOUT_ENABLED=false` blocks activation deployment-wide.
- An administrator hold blocks one merchant; it is audited and merchant-scoped.

Internal records still store connected / enabled / paused / action required /
administrator-held / provider unavailable. Only the **merchant-facing** control
was removed.

### Approval evidence

A browser return is **never** approval. It only returns the merchant to
PineTree, which then performs an authoritative provider lookup. Approval comes
solely from that lookup or a signature-verified provider webhook.

The provider does not document iframe embedding of its hosted KYC flow, so
PineTree does **not** embed it — it performs a same-window handoff with a
PineTree return route and automatic status synchronization.

---

## Reuse the profile PineTree already has (KYB prefill contract)

**Implemented.** `engine/bridgeCustomerPayload.ts` is a pure mapper from the
Business Profile onto the provider's business-customer schema, and it is the
only place that mapping exists.

PineTree **submits the data it already holds**. A merchant is never asked to
re-enter:

- legal business name, DBA, description, industry, legal structure
- business address, phone, website
- estimated revenue, expected volume, account purpose, source of funds
- regulated-activity, prohibited-country, and money-services answers
- owner / controller details, title, ownership percentage, residential address
- contact details

Only material PineTree genuinely does not hold — identity documents and similar
sensitive compliance evidence — may prompt further merchant input, and that is
collected on the provider-hosted page, never by PineTree.

The mapper returns the **PineTree field labels** that are still missing rather
than throwing, so an incomplete profile produces a fixable PineTree error
instead of a provider rejection. The required-field set stays owned by
`BUSINESS_PROFILE_REQUIRED_FIELDS`, and the provider remains internal
infrastructure that is never named to merchants outside the consent disclosure.

### Create once, update forever

- The stored provider customer id is reused whenever one exists.
- With no stored id, creation sends a **deterministic** idempotency key derived
  from the merchant id, so even a lost PineTree record cannot produce a second
  customer.
- A later Business Profile edit issues a **partial update** against that same
  customer. An unchanged profile produces the same payload fingerprint and makes
  no provider call at all.
- No migration mass-creates customers. Existing merchants are ensured lazily,
  when they proceed through the flow.

### Provider terms and the sandbox

Production requires a real `signed_agreement_id`, obtained on the provider's own
hosted terms page and captured server-side on return. Without one, **no customer
is created** — the merchant is asked to complete that step first.

The sandbox is different, and deliberately so: the provider documents that
sandbox customers are created via the API, that KYC links do not work there,
that a production agreement id "cannot be arbitrary", and that no
payment-related webhooks fire. PineTree therefore derives a deterministic
synthetic agreement id **only** when `BRIDGE_ENVIRONMENT` is exactly `sandbox`.
That check fails closed: an unset or unrecognized value is not sandbox, so the
shortcut cannot leak into production.

---

## Bank withdrawals

Once verification is complete, a merchant can withdraw USDC to a US bank account
from **PineTree Wallet → Withdraw → Bank account**. It is not on the Providers
page, and there is no connection step: it is a destination inside the withdrawal
experience the merchant already uses.

```
PineTree Wallet -> Withdraw -> "Bank account"
  -> link bank account (once)          POST /api/wallets/pinetree-wallet/bank-destinations
  -> review                            POST /api/wallets/pinetree-wallet/bank-withdrawals
  -> authorize in the merchant's own PineTree Wallet (existing Dynamic signing)
  -> submit                            (existing prepare/submit routes, unchanged)
  -> PROCESSING until the bank is paid
```

Supported today: **USDC on Base** and **USDC on Solana**, settling to **USD over
ACH**. Native ETH and SOL would need a conversion step before settlement; no
conversion provider is integrated, so they are simply unavailable rather than
silently mis-routed. Bitcoin/Lightning withdrawals are untouched and never route
through settlement.

### What confirms a bank withdrawal

**Only authoritative payout evidence from the settlement provider.** A confirmed
source-chain transaction proves the merchant's USDC reached the provider; it is
recorded as `source_chain_confirmed_at` and the withdrawal stays PROCESSING.

None of the following may confirm a bank withdrawal: clicking Approve, a wallet
return, a Dynamic signing result, transaction submission, a confirmed
source-chain receipt, `funds_received`, or `payment_submitted`.

| Provider payout state | Canonical withdrawal | Note |
|---|---|---|
| `awaiting_funds`, `in_review`, `funds_received`, `payment_submitted` | PROCESSING | In flight. Never confirmation. |
| `payment_processed` | **CONFIRMED** | The only path to success. |
| `undeliverable`, `returned`, `refunded`, `canceled` | FAILED | Verified terminal failure, each with its own merchant-safe message. |
| `refund_in_flight` | PROCESSING | Payout failed; the return is still moving. Flagged for an operator. |
| `refund_failed`, `missing_return_policy` | FAILED | Flagged for an operator. |
| `error` | *unchanged* | **UNKNOWN**, not failure. Reconciliation keeps looking; nothing is resubmitted. |
| unrecognized | *unchanged* | Never guessed into a real state. |

Ordering is enforced twice: along the documented forward progression, and by
timestamp for the states off that path. A late `funds_received` therefore cannot
regress a stored `payment_processed`, and a terminal withdrawal is never
reopened.

### Reconciliation

`reconcileBankWithdrawalsEngine` runs inside the existing withdrawal
reconciliation worker — not a second scheduler — and correlates payout evidence
to a withdrawal by **deposit transaction hash within one settlement route**.
Every deposit creates its own payout record, so that hash is the correlation
key. This lookup, not the webhook, is what makes the outcome eventually
knowable: the provider fires no payment webhooks in sandbox at all, and webhook
delivery in production is at-least-once rather than guaranteed-once.

### Settlement routes

A settlement route is the permanent pairing of one source chain + asset with one
bank destination. Duplicate creation is prevented in three layers: PineTree's
own stored route is reused first, then the provider's existing routes are
enumerated and matched, and only then is one created with a deterministic
idempotency key derived from the complete route identity.

The provider requires a return address on the **same source chain**, used when a
deposit cannot be processed. PineTree always supplies the merchant's own
PineTree Wallet address for that chain, and refuses to create a route without a
valid one — an unreturnable deposit is worse than a blocked withdrawal.

### Fees

PineTree charges **no** bank-withdrawal fee today and sets **no** provider
developer fee. The merchant withdrawal-fee policy is not finalized, so nothing
is hardcoded and nothing is fabricated.

---

## Existing merchants

No existing merchant is asked to create a new account, and no migration
mass-creates provider customers.

| Case | Behavior |
|---|---|
| Complete profile, no provider record | Prompted once for consent; submission is idempotent afterwards. |
| Incomplete profile | Directed to the missing fields. All existing data preserved. |
| Existing provider onboarding | Reused. Never duplicated. |
| Approved | Projected as Verified; eligible capabilities activate automatically. |
| Rejected / paused / more info needed | Safe PineTree copy and action; raw payloads stay in admin diagnostics. |

---

## Data

Bridge state remains in `merchant_providers.credentials` (provider = `bridge`),
service-role only. Consent lives in `merchant_service_terms_acceptances`
(append-only, service-role only). Bank payout destinations live in
`merchant_bank_destinations` and their settlement routes in
`merchant_bridge_liquidation_routes`, both service-role only. All are
forward-only migrations.

`merchant_providers`, `merchant_bank_destinations`, and
`merchant_bridge_liquidation_routes` are never readable by the browser; the UI
only ever sees the Engine's projection.

### Sensitive data

**Never stored:** identity documents, SSNs, EINs, beneficial-owner documents,
raw bank routing or account numbers, hosted onboarding URLs, provider keys, or
raw provider payloads.

Tax identifiers are collected in the Business Profile's Verification section and
travel **browser → authenticated PineTree API → provider** inside a single
request. `app/api/merchant/business-profile/route.ts` strips them before the
profile writer runs, so there is no column they could reach. What survives is
the masked last four and the timestamp of the submission that consumed them,
which is why the form afterwards shows `On file ····6789 — leave blank to keep`
rather than a value.

A bank account number behaves identically: it exists only for the duration of
the create call and PineTree persists the provider's external-account id and the
masked last four the provider itself returns.

`providers/bridge/redact.ts` is the single redaction point and covers these keys
recursively, so a field that ever reached the logging layer still could not be
written to a log.
