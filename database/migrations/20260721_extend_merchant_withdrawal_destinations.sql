-- Completes the address book (merchant_withdrawal_destinations, created by
-- 20260720_create_merchant_withdrawal_destinations.sql, which must be applied
-- before this file) with the fields a full Address Book UI needs: enable/
-- disable, provider attribution, an optional memo/tag, an explicit merchant-
-- confirmation state, last-used tracking, and archive (soft delete).
--
-- Also fixes a real bug in the original unique index: it was
-- (merchant_id, rail, destination_address) - missing `asset` - which wrongly
-- blocked saving the SAME address once for Base ETH and again for Base USDC,
-- even though an exchange may support one deposit route and not the other.

drop index if exists public.merchant_withdrawal_destinations_unique_idx;

create unique index merchant_withdrawal_destinations_unique_idx
  on public.merchant_withdrawal_destinations (
    merchant_id, rail, asset, coalesce(method, ''), destination_address
  );

alter table public.merchant_withdrawal_destinations
  add column if not exists is_enabled boolean not null default true,
  add column if not exists provider_name text,
  add column if not exists memo_or_tag text,
  add column if not exists confirmation_status text not null default 'unconfirmed'
    check (confirmation_status in ('unconfirmed', 'confirmed')),
  add column if not exists merchant_confirmed_at timestamptz,
  add column if not exists last_used_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Archived rows stay for audit/history (withdrawals may still reference them
-- via destination_id) but must never resurface as an active, selectable
-- destination for a new withdrawal or sweep rule.
create index if not exists merchant_withdrawal_destinations_active_idx
  on public.merchant_withdrawal_destinations (merchant_id, rail)
  where archived_at is null;

comment on column public.merchant_withdrawal_destinations.is_enabled is
  'Merchant can disable a destination without archiving it - disabled destinations are hidden from withdrawal/sweep pickers but remain editable and re-enableable.';
comment on column public.merchant_withdrawal_destinations.confirmation_status is
  'unconfirmed until the merchant explicitly acknowledges the irreversible-transfer warning for this exact destination (see engine/withdrawals/withdrawalDestinations.ts). Automatic sweep rules require confirmed.';
comment on column public.merchant_withdrawal_destinations.archived_at is
  'Soft delete. Destinations referenced by withdrawal history (destination_id) cannot be hard-deleted - only archived.';
