# PineTree Architecture (STRICT)

## Core Architecture

UI → API → ENGINE → PROVIDERS → DATABASE

---

## Layer Responsibilities

### UI (app/)
- Display only
- No business logic
- No fee calculation
- No status updates

### API (app/api/)
- Thin wrappers only
- Validate input
- Call engine
- No business logic

### ENGINE (/engine)
- Central brain
- Handles ALL payment logic
- Handles ALL state transitions
- Processes ALL events

### PROVIDERS (/providers)
- External API communication only
- Must NOT update DB
- Must NOT contain business logic

### DATABASE
- Source of truth
- payments.status is authoritative

---

## Payment Flow

1. UI → API
2. API → engine/createPayment
3. Engine:
   - validate
   - calculate fee
   - create DB record
   - route provider
   - call adapter
4. Provider returns payment data
5. UI displays QR

Customer payment:

6. Customer pays
7. Provider detects
8. Webhook triggered
9. Webhook → translateEvent
10. → engine/eventProcessor
11. → DB update

---

## State Machine

CREATED → PENDING → PROCESSING → CONFIRMED

Alternative:
- PENDING → INCOMPLETE
- PROCESSING → FAILED

---

## Merchant Status Architecture (AUTHORITATIVE)

This section is the single source of truth for merchant-facing financial status
presentation. Provider, blockchain, wallet, and integration terminology must be
translated at system boundaries and must never determine labels in the UI.

The canonical payment database state machine remains the six-state lifecycle
above. Expired and Canceled are presentation outcomes derived from terminal
`INCOMPLETE` lifecycle evidence. Refunded is a post-settlement transaction
adjustment; it is not a payment-state transition. Disputed is reserved for future
architecture and must not imply that dispute processing exists today.

| Merchant status | Meaning | Color | Icon |
|---|---|---|---|
| Waiting | Payment request exists and needs customer action. | Blue | Clock |
| Processing | Payment was detected and awaits confirmation. | Darker blue | Animated spinner |
| Confirmed | Payment completed successfully. | Green | Check circle |
| Failed | Provider or network evidence proves failure. | Red | X circle |
| Expired | An unpaid payment request timed out. | Muted red | X circle |
| Canceled | The payment was intentionally canceled or otherwise abandoned. | Gray | X circle |
| Refunded | Settled funds were returned after confirmation. | Orange | Refund arrow |
| Disputed | Reserved presentation for future dispute architecture. | Amber | Warning triangle |
| Unknown | A value is not recognized. Defensive fallback only. | Neutral gray | Minus circle |

Rules:

- UI, reports, receipts, notifications, email, and merchant APIs use the shared
  Engine-owned presentation contract in `lib/utils/paymentStatus.ts`.
- `CREATED` and `PENDING` display as Waiting. Merchant surfaces never display Pending.
- A bare `INCOMPLETE` record displays as Canceled; explicit expiry evidence displays Expired.
- Legacy aliases such as `CANCELLED`, `payment.cancelled`, `PAID`, `COMPLETED`,
  provider `ERROR`, and provider `REJECTED` may be accepted at boundaries but are
  never emitted as merchant labels.
- Unknown provider values log diagnostics and normalize to Unknown. They must not
  masquerade as Waiting and must not advance canonical payment state.
- Refunded remains distinct in transaction history, filtering, summaries, reports,
  and exports. It must not fall through to Unknown or display as Confirmed.
- Provider adapters translate external values. They do not own merchant labels,
  mutate database rows, or bypass PineTree Engine reconciliation.
- The canonical public cancellation event is `payment.canceled`. The British
  spelling is accepted only for legacy compatibility.

Other status documentation must reference this section instead of defining a
second merchant presentation standard.

---

## Critical Rules

- ONLY engine/eventProcessor updates status
- Watchers MUST NOT update DB
- Webhooks MUST NOT update DB
- Providers MUST NOT update DB
- UI MUST NOT update status
- No duplicate logic allowed
- No duplicate engine folders

---

## Event Flow (MANDATORY)

event → processPaymentEvent → updatePaymentStatus → DB

---

## Background Jobs (AUTHORITATIVE)

This section is the single source of truth for PineTree recurring, scheduled,
manual-maintenance, and deferred background work. Other documents must link to
this section instead of copying scheduler details.

### Production Recurring Jobs

PineTree has exactly one production recurring scheduler.

| Job | Owner | Schedule | Target | Authentication | Purpose |
|---|---|---|---|---|---|
| Stale Payment Sweep | Supabase `pg_cron` (`jobid: 5`, `pinetree-sweep-stale-payments`) | `* * * * *` (every minute) | `POST /api/cron/sweep-stale-payments` | `Authorization: Bearer ${CRON_SECRET}` | Expire abandoned payments, enforce canonical payment state, reconcile lifecycle state and transaction snapshots, and prevent orphaned Waiting payments. |

The Supabase job is active and uses `cron.schedule` plus `net.http_post`.
Its request reads the bearer value through `vault.decrypted_secrets`; the
route validates the matching `CRON_SECRET` stored in Vercel production.
Neither the secret nor the Supabase control-plane job definition belongs in
tracked application files.

```text
Supabase pg_cron
        |
        v
POST /api/cron/sweep-stale-payments
        |
        v
PineTree Engine
        |
        v
Canonical Payment Lifecycle
        |
        v
Transaction Reconciliation
        |
        v
Dashboard / Reports / Wallet
```

The route calls Engine lifecycle helpers. It does not use direct SQL status
updates as the primary cleanup mechanism. Compare-and-set transitions,
canonical payment-evidence checks, lifecycle events, and transaction
reconciliation remain inside PineTree Engine.

### Removed Legacy Jobs

The Supabase jobs `cleanup-pending-transactions` and
`expire-pending-transactions` were intentionally removed. They directly
modified database rows and bypassed PineTree Engine transition guards, event
creation, canonical evidence checks, and transaction reconciliation. The
Stale Payment Sweep is their canonical replacement. Do not recreate them.

### Manual Maintenance Jobs

These routes are authenticated and intentionally not scheduled. Invoking one
is an explicit operational or administrative action.

| Job | Route / engine | Authentication | Purpose | Status |
|---|---|---|---|---|
| Full payment maintenance tick | `GET /api/cron/check-payments` -> `runPaymentMaintenanceTick` | `CRON_SECRET` bearer | Run a bounded stale sweep, provider watcher checks, and terminal transaction reconciliation. | Manual; not scheduled |
| Wallet balance refresh | `GET /api/cron/update-balances` -> `refreshAllWalletBalancesEngine` | `CRON_SECRET` bearer | Refresh all merchant wallet balance snapshots. | Manual; not scheduled |
| API idempotency cleanup | `POST /api/cron/cleanup-api-idempotency` -> `cleanupExpiredApiIdempotencyClaims` | `CRON_SECRET` bearer | Delete expired completed idempotency claims while retaining unresolved claims. | Manual; not scheduled |
| Transaction reconciliation backfill | `POST /api/admin/backfill/reconcile-transactions` -> `runTransactionBackfill` | Admin session; execute mode also requires the confirmation token | Inspect or repair historical payment/transaction divergence. Defaults to dry-run. | Manual; not scheduled |
| Withdrawal reconciliation | `POST /api/internal/wallets/pinetree/reconcile-withdrawals` -> `reconcileProcessingWithdrawals` | `CRON_SECRET` or `INTERNAL_API_SECRET` bearer | Recheck bounded processing withdrawal batches. | Manual; not scheduled |
| Lightning payout processing | `POST /api/internal/lightning-payouts/process` -> `processPendingLightningPayoutJobs` | `CRON_SECRET` or `INTERNAL_API_SECRET` bearer | Process a bounded batch of pending Lightning payout jobs. | Manual; not scheduled |
| Lightning settlement payout processing | `POST /api/internal/lightning-settlement-payouts/process` -> `processQueuedLightningSettlementPayoutJobs` | `INTERNAL_API_SECRET` bearer | Process queued Lightning settlement payouts using saved merchant destinations. | Manual; not scheduled |
| Base payment chain reconciliation | `POST /api/internal/base-payments/[paymentId]/reconcile` -> `reconcileBasePaymentFromChain` | `CRON_SECRET` or `INTERNAL_API_SECRET` bearer | Re-verify a single Base (ETH/USDC) payment directly against the chain and repair it (including a falsely INCOMPLETE payment) if genuine on-chain evidence is found. Also run automatically, bounded, inside the full payment maintenance tick. | Manual + event-triggered; not scheduled |

### Event-Triggered Deferred Work

These bounded workers use Next.js `after()` following a request or verified
provider event. They can run repeatedly as activity occurs, but they are not
time-based schedulers and do not change the one-scheduler production rule.

| Worker | Owner / trigger | Engine call | Purpose | Status |
|---|---|---|---|---|
| Request-triggered payment maintenance | PineTree API reads for payments, transactions, dashboard, and admin views | `runPaymentMaintenanceTick` | Opportunistically refresh payment/watch status and reconcile snapshots between scheduled sweeps. | Production; event-triggered |
| Lightning sweep processing | Verified Speed webhook or merchant wallet read when work is due | `processQueuedLightningSweeps` | Advance bounded queued Lightning sweep work without delaying the triggering response. | Production; event-triggered |
| Wallet withdrawal maintenance | Withdrawal submission or PineTree Wallet sync | `reconcileProcessingWithdrawals` | Recheck recently submitted processing withdrawals. | Production; event-triggered |
| Wallet readiness synchronization | PineTree Wallet profile upsert | `syncPineTreeWalletProfileProviders` | Synchronize provider readiness after a profile change. | Production; event-triggered |

### Future Background Jobs

The following are architecture placeholders only. They do not currently have
schedules, deployed workers, or production ownership:

| Candidate | Intended purpose | Status |
|---|---|---|
| Provider reconciliation | Periodically compare provider state with canonical PineTree payment state. | Future architecture only |
| Wallet synchronization | Refresh wallet state independently of merchant requests where required. | Future architecture only |
| Settlement reconciliation | Reconcile provider settlements, fees, and merchant balances. | Future architecture only |
| Analytics aggregation | Precompute bounded operational and reporting aggregates. | Future architecture only |
| Scheduled reporting | Generate and deliver explicitly configured recurring merchant reports. | Future architecture only |
| Webhook retry reconciliation | Requeue eligible failed webhook deliveries under a documented retry policy. | Future architecture only |

Any future recurring job must update this section, identify one owner and
schedule, use an authenticated Engine entry point, and confirm it does not
duplicate an existing scheduler.

---

## Fee Model (Core Rules)

- Fee MUST be collected at payment time
- gross_amount = merchant_amount + pinetree_fee
- Payment is NOT valid unless fee is captured

---

## Final Rule

If implementation breaks architecture:

DO NOT implement — refactor instead.
