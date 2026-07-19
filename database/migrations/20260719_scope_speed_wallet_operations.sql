-- Bind wallet activity to the exact connected account and preserve Speed's
-- stable transaction/related-object identifiers for idempotent synchronization.
-- Additive only: no amounts or historical financial states are rewritten.

alter table public.merchant_wallet_operations
  add column if not exists provider_account_id text,
  add column if not exists provider_transaction_id text,
  add column if not exists provider_secondary_reference text,
  add column if not exists provider_created_at timestamptz;

-- Existing Speed rows can be attributed only when PineTree already has the
-- canonical acct_ identifier for that same merchant. Rows for merchants with
-- no canonical account remain NULL and are never returned by account-scoped
-- synchronization lookups.
update public.merchant_wallet_operations operation
set provider_account_id = profile.speed_account_id
from public.merchant_lightning_profiles profile
where operation.provider = 'speed'
  and operation.provider_account_id is null
  and profile.merchant_id = operation.merchant_id
  and profile.speed_account_id like 'acct\_%' escape '\';

-- Code deployed before this migration stores the same values in the internal
-- sanitized compatibility object so financial flows remain available during
-- code-first rollout. Promote those values into dedicated columns.
update public.merchant_wallet_operations
set provider_account_id = coalesce(provider_account_id, raw_provider_status ->> 'providerAccountId'),
    provider_transaction_id = coalesce(provider_transaction_id, raw_provider_status ->> 'providerTransactionId'),
    provider_secondary_reference = coalesce(provider_secondary_reference, raw_provider_status ->> 'providerSecondaryReference'),
    provider_created_at = coalesce(
      provider_created_at,
      case
        when (raw_provider_status ->> 'providerCreatedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
          then (raw_provider_status ->> 'providerCreatedAt')::timestamptz
        else null
      end
    )
where raw_provider_status is not null;

create unique index if not exists merchant_wallet_operations_provider_txn_account_uidx
  on public.merchant_wallet_operations
    (provider, provider_account_id, provider_transaction_id)
  where provider_account_id is not null and provider_transaction_id is not null;

create unique index if not exists merchant_wallet_operations_provider_ref_account_uidx
  on public.merchant_wallet_operations
    (provider, provider_account_id, provider_reference)
  where provider_account_id is not null and provider_reference is not null;

create index if not exists merchant_wallet_operations_provider_secondary_account_idx
  on public.merchant_wallet_operations
    (provider, provider_account_id, provider_secondary_reference)
  where provider_account_id is not null and provider_secondary_reference is not null;

create index if not exists merchant_wallet_operations_account_created_idx
  on public.merchant_wallet_operations
    (merchant_id, provider, provider_account_id, provider_created_at desc);

-- The original global provider-reference index cannot represent two distinct
-- connected accounts. Retire it only after the account-scoped index exists.
drop index if exists public.merchant_wallet_operations_provider_reference_uidx;

comment on column public.merchant_wallet_operations.provider_account_id is
  'Server-resolved connected account that owns this operation; never accepted from browser input.';
comment on column public.merchant_wallet_operations.provider_transaction_id is
  'Stable Speed balance-transaction ID used for account-scoped synchronization deduplication.';
comment on column public.merchant_wallet_operations.provider_secondary_reference is
  'Related provider object ID, such as the withdraw_id created by Instant Send.';
comment on column public.merchant_wallet_operations.provider_created_at is
  'Provider-reported creation timestamp retained independently from PineTree row creation time.';
