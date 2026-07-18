-- DEPLOYMENT SQL BLOCK: bind cached balances to their provider account.
-- Apply through the production migration runner after backup/change review.
-- Bind every cached wallet balance to the provider account that produced it.
-- Existing unbound rows remain stored but are not returned by the account-
-- scoped application query, preventing an old connected account's balance
-- from appearing after a merchant reconnects a different provider account.

alter table public.merchant_wallet_balance_snapshots
  add column if not exists provider_account_id text;

create unique index if not exists merchant_wallet_balance_snapshots_account_uidx
  on public.merchant_wallet_balance_snapshots
    (merchant_id, provider, provider_account_id, asset, network);

-- Retire the previous account-agnostic uniqueness rule only after the new
-- account-scoped index exists, avoiding an unconstrained deployment window.
drop index if exists public.merchant_wallet_balance_snapshots_uidx;

create index if not exists merchant_wallet_balance_snapshots_account_lookup_idx
  on public.merchant_wallet_balance_snapshots
    (merchant_id, provider, provider_account_id);

comment on column public.merchant_wallet_balance_snapshots.provider_account_id is
  'Server-resolved provider account identity that produced this balance snapshot; never exposed to merchant clients.';
