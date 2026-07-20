-- Address book for PineTree Wallet withdrawal destinations (wallet_withdrawal_requests).
-- Merchants can save a labeled destination per rail so it doesn't need to be
-- re-typed on every withdrawal. Rail-aware: for "bitcoin", method further
-- distinguishes an on-chain Bitcoin address from a Lightning destination
-- (Lightning Address or BOLT11 invoice) - a saved Bitcoin Network destination
-- must never be offered when the merchant is withdrawing via Lightning, and
-- vice versa.
create table if not exists public.merchant_withdrawal_destinations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  rail text not null check (rail in ('base', 'solana', 'bitcoin')),
  asset text not null check (asset in ('ETH', 'USDC', 'SOL', 'BTC')),
  method text check (method in ('onchain', 'lightning')),
  destination_address text not null,
  label text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Bitcoin destinations must carry a method (onchain vs lightning); every
  -- other rail has exactly one implicit method and must leave it null.
  constraint merchant_withdrawal_destinations_method_matches_rail check (
    (rail = 'bitcoin' and method is not null) or (rail <> 'bitcoin' and method is null)
  )
);

create unique index if not exists merchant_withdrawal_destinations_unique_idx
  on public.merchant_withdrawal_destinations (merchant_id, rail, destination_address);

create index if not exists merchant_withdrawal_destinations_merchant_idx
  on public.merchant_withdrawal_destinations (merchant_id, rail);

alter table public.merchant_withdrawal_destinations enable row level security;

-- Server-only, same lockdown pattern as merchant_speed_credentials: all reads
-- and writes go through database/merchantWithdrawalDestinations.ts using the
-- service-role client, gated by requireMerchantIdFromRequest at the API
-- layer. No merchant, authenticated client, or anonymous access whatsoever.
revoke all on public.merchant_withdrawal_destinations from anon, authenticated;

comment on table public.merchant_withdrawal_destinations is
  'Merchant-saved withdrawal destinations for PineTree Wallet withdrawals (wallet_withdrawal_requests). Rail-aware; Bitcoin rows carry an explicit onchain/lightning method. Service-role access only.';
