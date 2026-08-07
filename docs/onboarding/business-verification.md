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
| `POST .../continue` | Single-use hosted verification URL. |
| `POST .../refresh` | Authoritative provider lookup + automatic activation. |
| `POST /api/webhooks/bridge` | Unchanged. Raw-body signature verification, dedup, ordering. |
| `GET|PATCH /api/admin/business-verification` | Admin diagnostics and rollout hold. |

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

**Not yet implemented.** Recorded here so the boundary is unambiguous before the
provider KYB integration is built.

PineTree already collects a complete merchant business profile
(`engine/businessProfile.ts`, **Settings → Business Profile**). When provider
KYB is implemented, PineTree **submits the data it already holds** and prefills
wherever the provider's API permits. A merchant must never be asked to re-enter:

- legal business name, DBA
- business address, phone, website
- business type and tax/registration information
- owner / controller / authorized-representative details
- contact details

Only information the provider genuinely requires and PineTree does **not**
already hold — typically identity documents and other sensitive compliance
material — may prompt additional merchant input, and that is collected on the
provider-hosted page, never by PineTree.

This is a submission contract, not a new data model: the required-field set
stays owned by `BUSINESS_PROFILE_REQUIRED_FIELDS`, and the provider remains
internal infrastructure that is never named to merchants outside the consent
disclosure.

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
(append-only, service-role only). Both are forward-only migrations.

Never stored: identity documents, SSNs, EINs, beneficial-owner documents, bank
credentials, hosted onboarding URLs, provider keys, or raw provider payloads.
Sensitive compliance data goes from the merchant's browser to the provider and
never transits PineTree.

`merchant_providers` is never readable by the browser; the UI only ever sees the
Engine's projection.
