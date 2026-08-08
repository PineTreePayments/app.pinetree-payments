-- Bridge bank withdrawals: Business Profile verification fields, merchant bank
-- payout destinations, settlement routes, and withdrawal <-> payout correlation.
--
-- DESIGN
--   * The Business Profile stays the ONE merchant-facing business identity.
--     The new columns extend `merchant_settings`; no second profile table and
--     no second merchant identity record is introduced.
--   * Bank withdrawals reuse the EXISTING withdrawal lifecycle in
--     `wallet_withdrawal_requests`. This migration adds correlation columns to
--     that table; it does not create a second withdrawal ledger.
--   * A bank destination is NOT an entry in `merchant_withdrawal_destinations`.
--     That table is the crypto address book: its identity is
--     (rail, asset, method, destination_address) with an on-chain address, and
--     its rail constraint admits only base/solana/bitcoin. A US bank account
--     has no on-chain address, so it gets its own table rather than a provider
--     identifier written into an address column.
--
-- SENSITIVE DATA - NEVER STORED HERE
--   EIN/TIN/SSN, government identification, identity documents, raw bank
--   routing or account numbers, provider API keys, or webhook verification
--   material. Only provider resource identifiers, provider-returned masked last
--   four values, normalized statuses, and timestamps are persisted.
--
-- Forward-only. Every statement is additive and idempotent; no existing
-- merchant, provider, payment, withdrawal, or ledger row is read, updated, or
-- deleted.

begin;

-- ── Preflight ────────────────────────────────────────────────────────────────
do $preflight$
begin
  if to_regclass('public.merchants') is null
     or to_regclass('public.merchant_settings') is null
     or to_regclass('public.wallet_withdrawal_requests') is null
     or to_regclass('public.bridge_webhook_events') is null then
    raise exception 'Bridge bank withdrawals require merchants, merchant_settings, wallet_withdrawal_requests and bridge_webhook_events';
  end if;

  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'Bridge bank withdrawals require gen_random_uuid()';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Bridge bank withdrawals require the service_role database role';
  end if;
end
$preflight$;

-- ── 1. Business Profile verification fields ──────────────────────────────────
-- Entered once by the merchant in Settings -> Business Profile and reused for
-- every verification submission. Compliance answers are stored exactly as the
-- merchant answered them; PineTree never defaults one.
alter table public.merchant_settings
  add column if not exists business_legal_structure          text,
  add column if not exists business_industry                 text,
  add column if not exists business_description              text,
  add column if not exists estimated_annual_revenue          text,
  add column if not exists expected_monthly_payment_volume   text,
  add column if not exists account_purpose                   text,
  add column if not exists source_of_funds                   text,
  -- Comma-separated controlled values. 'none_of_the_above' is an explicit
  -- merchant answer, never an assumed default.
  add column if not exists high_risk_activities              text,
  add column if not exists operates_in_prohibited_countries  text,
  add column if not exists conducts_money_services           text,
  add column if not exists owner_title                       text,
  add column if not exists owner_birth_date                  text,
  add column if not exists owner_ownership_percentage        text,
  add column if not exists owner_address_line1               text,
  add column if not exists owner_address_line2               text,
  add column if not exists owner_city                        text,
  add column if not exists owner_state                       text,
  add column if not exists owner_postal_code                 text,
  add column if not exists owner_country                     text;

alter table public.merchant_settings
  drop constraint if exists merchant_settings_yes_no_answers_check;

alter table public.merchant_settings
  add constraint merchant_settings_yes_no_answers_check check (
    (operates_in_prohibited_countries is null
       or operates_in_prohibited_countries in ('yes', 'no'))
    and (conducts_money_services is null
       or conducts_money_services in ('yes', 'no'))
  );

comment on column public.merchant_settings.high_risk_activities is
  'Explicit merchant answer to the regulated/high-risk activity question, comma separated. PineTree never infers or defaults this value.';

-- ── 2. Merchant bank payout destinations ─────────────────────────────────────
create table if not exists public.merchant_bank_destinations (
  id                            uuid        primary key default gen_random_uuid(),
  merchant_id                   uuid        not null references public.merchants (id) on delete restrict,
  -- The settlement provider that holds this destination.
  provider                      text        not null default 'bridge',
  -- The provider's external-account identifier. Null until the provider
  -- confirms one, which is what makes the reserve-then-submit flow safe.
  provider_external_account_id  text,
  label                         text        not null default '',
  bank_name                     text,
  account_owner_name            text,
  -- Masked last four, exactly as the provider returned it. The account number
  -- itself is never written to this table or any other.
  account_last4                 text,
  account_kind                  text,
  currency                      text        not null default 'usd',
  country                       text        not null default 'USA',
  payment_rail                  text        not null default 'ach',
  status                        text        not null default 'pending',
  is_default                    boolean     not null default false,
  provider_deactivation_reason  text,
  last_used_at                  timestamptz,
  archived_at                   timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint merchant_bank_destinations_status_check
    check (status in ('pending', 'active', 'archived')),
  constraint merchant_bank_destinations_kind_check
    check (account_kind is null or account_kind in ('checking', 'savings')),
  -- Four digits at most: a longer value would mean something other than a mask
  -- reached this column.
  constraint merchant_bank_destinations_last4_check
    check (account_last4 is null or account_last4 ~ '^[0-9]{1,4}$')
);

-- One provider external account belongs to exactly one PineTree merchant.
create unique index if not exists merchant_bank_destinations_provider_account_uidx
  on public.merchant_bank_destinations (provider_external_account_id)
  where provider_external_account_id is not null;

create index if not exists merchant_bank_destinations_merchant_idx
  on public.merchant_bank_destinations (merchant_id, created_at desc)
  where archived_at is null;

comment on table public.merchant_bank_destinations is
  'Merchant bank payout destinations for withdrawals that settle to fiat. Stores the settlement provider''s external-account identifier and the masked last four it returned - never a routing number or an account number.';

-- ── 3. Settlement routes ─────────────────────────────────────────────────────
-- A permanent pairing of one source chain + asset with one bank destination.
-- The provider issues its deposit address once and it never changes.
create table if not exists public.merchant_bridge_liquidation_routes (
  id                              uuid        primary key default gen_random_uuid(),
  merchant_id                     uuid        not null references public.merchants (id) on delete restrict,
  bank_destination_id             uuid        not null references public.merchant_bank_destinations (id) on delete restrict,
  provider_customer_id            text        not null,
  provider_external_account_id    text        not null,
  provider_liquidation_address_id text        not null,
  -- The on-chain address a merchant withdrawal is sent to.
  deposit_address                 text        not null,
  source_rail                     text        not null,
  source_asset                    text        not null,
  destination_payment_rail        text        not null default 'ach',
  destination_currency            text        not null default 'usd',
  -- Same-chain address the provider returns unprocessable deposits to. Always
  -- the merchant's own PineTree Wallet address for that chain.
  return_address                  text        not null,
  state                           text        not null default 'active',
  archived_at                     timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint merchant_bridge_liquidation_routes_rail_check
    check (source_rail in ('base', 'solana')),
  constraint merchant_bridge_liquidation_routes_asset_check
    check (source_asset = 'USDC')
);

-- One route per (merchant, bank destination, source rail, source asset). This
-- is what makes route creation converge instead of racing into a second
-- permanent provider route.
create unique index if not exists merchant_bridge_liquidation_routes_identity_uidx
  on public.merchant_bridge_liquidation_routes
     (merchant_id, bank_destination_id, source_rail, source_asset);

-- How a verified drain webhook resolves its tenant.
create unique index if not exists merchant_bridge_liquidation_routes_provider_uidx
  on public.merchant_bridge_liquidation_routes (provider_liquidation_address_id);

create index if not exists merchant_bridge_liquidation_routes_merchant_idx
  on public.merchant_bridge_liquidation_routes (merchant_id, created_at desc)
  where archived_at is null;

comment on table public.merchant_bridge_liquidation_routes is
  'Permanent settlement routes pairing a source chain/asset with a merchant bank destination. Infrastructure only - never merchant-facing vocabulary.';

-- ── 4. Withdrawal <-> payout correlation ─────────────────────────────────────
-- Bank withdrawals reuse the existing withdrawal lifecycle. These columns carry
-- the extra evidence a bank payout has that a crypto withdrawal does not.
--
-- destination_kind defaults to 'crypto', so every existing withdrawal keeps its
-- current behavior by construction: a confirmed source-chain transaction still
-- confirms a crypto withdrawal. For 'bank', a confirmed source-chain
-- transaction proves only that funds reached the settlement provider, and the
-- withdrawal stays PROCESSING until authoritative payout evidence arrives.
alter table public.wallet_withdrawal_requests
  add column if not exists destination_kind             text        not null default 'crypto',
  add column if not exists bank_destination_id          uuid        references public.merchant_bank_destinations (id) on delete restrict,
  add column if not exists liquidation_route_id         uuid        references public.merchant_bridge_liquidation_routes (id) on delete restrict,
  add column if not exists source_chain_confirmed_at    timestamptz,
  add column if not exists settlement_drain_id          text,
  add column if not exists settlement_drain_state       text,
  -- ACH trace number or wire IMAD. Support evidence; never merchant-facing.
  add column if not exists settlement_payout_reference  text,
  add column if not exists settlement_updated_at        timestamptz;

alter table public.wallet_withdrawal_requests
  drop constraint if exists wallet_withdrawal_requests_destination_kind_check;

alter table public.wallet_withdrawal_requests
  add constraint wallet_withdrawal_requests_destination_kind_check
  check (destination_kind in ('crypto', 'bank'));

-- A bank withdrawal must always know where it settles.
alter table public.wallet_withdrawal_requests
  drop constraint if exists wallet_withdrawal_requests_bank_binding_check;

alter table public.wallet_withdrawal_requests
  add constraint wallet_withdrawal_requests_bank_binding_check
  check (
    destination_kind <> 'bank'
    or (bank_destination_id is not null and liquidation_route_id is not null)
  );

-- Every drain is unique, and each funds exactly one PineTree withdrawal.
create unique index if not exists wallet_withdrawal_requests_settlement_drain_uidx
  on public.wallet_withdrawal_requests (settlement_drain_id)
  where settlement_drain_id is not null;

-- The reconciliation work queue: nonterminal bank withdrawals awaiting payout
-- evidence.
create index if not exists wallet_withdrawal_requests_bank_pending_idx
  on public.wallet_withdrawal_requests (destination_kind, status, created_at)
  where destination_kind = 'bank' and status in ('pending', 'processing');

-- Drain correlation is by deposit transaction hash within one route.
create index if not exists wallet_withdrawal_requests_route_tx_idx
  on public.wallet_withdrawal_requests (liquidation_route_id, tx_hash)
  where liquidation_route_id is not null;

comment on column public.wallet_withdrawal_requests.destination_kind is
  'crypto (default): the destination address is the merchant''s own, so a confirmed source-chain transaction confirms the withdrawal. bank: the destination address belongs to the settlement provider, so a confirmed source-chain transaction proves only that funds reached the provider and the withdrawal stays PROCESSING until authoritative payout evidence arrives.';

-- ── 5. Webhook inbox: new event categories ───────────────────────────────────
-- The provider webhook endpoint is now subscribed to bank-destination and
-- payout events as well as the KYB ones.
alter table public.bridge_webhook_events
  add column if not exists bridge_external_account_id     text,
  add column if not exists bridge_liquidation_address_id  text,
  add column if not exists bridge_drain_id                text;

alter table public.bridge_webhook_events
  drop constraint if exists bridge_webhook_events_category_check;

alter table public.bridge_webhook_events
  add constraint bridge_webhook_events_category_check
  check (event_category in ('customer', 'kyc_link', 'external_account', 'liquidation_address.drain'));

alter table public.bridge_webhook_events
  drop constraint if exists bridge_webhook_events_skipped_reason_check;

alter table public.bridge_webhook_events
  add constraint bridge_webhook_events_skipped_reason_check
  check (
    skipped_reason is null
    or skipped_reason in (
      'duplicate',
      'out_of_order',
      'unresolved_merchant',
      'unsupported_category',
      'state_reread_failed',
      'no_matching_withdrawal',
      'unresolved_route'
    )
  );

create index if not exists bridge_webhook_events_drain_idx
  on public.bridge_webhook_events (bridge_liquidation_address_id, occurred_at desc)
  where bridge_liquidation_address_id is not null;

-- ── 6. Row level security ────────────────────────────────────────────────────
-- Service-role only, matching merchant_providers, bridge_webhook_events, and
-- the other provider/credential tables. Merchants reach their own bank
-- destinations exclusively through authenticated PineTree API routes, which
-- resolve merchant identity from the session and filter by merchant
-- server-side.
alter table public.merchant_bank_destinations enable row level security;
revoke all on public.merchant_bank_destinations from public;
revoke all on public.merchant_bank_destinations from anon;
revoke all on public.merchant_bank_destinations from authenticated;
grant select, insert, update on public.merchant_bank_destinations to service_role;

alter table public.merchant_bridge_liquidation_routes enable row level security;
revoke all on public.merchant_bridge_liquidation_routes from public;
revoke all on public.merchant_bridge_liquidation_routes from anon;
revoke all on public.merchant_bridge_liquidation_routes from authenticated;
grant select, insert, update on public.merchant_bridge_liquidation_routes to service_role;

notify pgrst, 'reload schema';

commit;
