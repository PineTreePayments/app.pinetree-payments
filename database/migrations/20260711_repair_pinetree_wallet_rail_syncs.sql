-- Production-safe repair for public.pinetree_wallet_rail_syncs.
-- Fixes PostgREST schema-cache/table-missing failures without dropping or
-- recreating the table, and preserves existing rows.

create table if not exists public.pinetree_wallet_rail_syncs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  rail text not null,
  synced_address text not null,
  synced_at timestamptz not null default now()
);

alter table public.pinetree_wallet_rail_syncs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists merchant_id uuid,
  add column if not exists rail text,
  add column if not exists synced_address text,
  add column if not exists synced_at timestamptz default now();

alter table public.pinetree_wallet_rail_syncs
  alter column id set default gen_random_uuid(),
  alter column synced_at set default now();

update public.pinetree_wallet_rail_syncs
set id = gen_random_uuid()
where id is null;

update public.pinetree_wallet_rail_syncs
set synced_at = now()
where synced_at is null;

alter table public.pinetree_wallet_rail_syncs
  alter column id set not null,
  alter column merchant_id set not null,
  alter column rail set not null,
  alter column synced_address set not null,
  alter column synced_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pinetree_wallet_rail_syncs'::regclass
      and contype = 'p'
  ) then
    alter table public.pinetree_wallet_rail_syncs
      add constraint pinetree_wallet_rail_syncs_pkey primary key (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pinetree_wallet_rail_syncs'::regclass
      and conname = 'pinetree_wallet_rail_syncs_merchant_id_fkey'
  ) then
    alter table public.pinetree_wallet_rail_syncs
      add constraint pinetree_wallet_rail_syncs_merchant_id_fkey
      foreign key (merchant_id) references public.merchants(id) on delete cascade
      not valid;
  end if;
end $$;

alter table public.pinetree_wallet_rail_syncs
  drop constraint if exists pinetree_wallet_rail_syncs_rail_check;

alter table public.pinetree_wallet_rail_syncs
  add constraint pinetree_wallet_rail_syncs_rail_check
  check (rail in ('solana', 'base', 'bitcoin_lightning'))
  not valid;

create unique index if not exists pinetree_wallet_rail_syncs_merchant_id_rail_key
  on public.pinetree_wallet_rail_syncs (merchant_id, rail);

create index if not exists pinetree_wallet_rail_syncs_merchant_id_idx
  on public.pinetree_wallet_rail_syncs (merchant_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pinetree_wallet_rail_syncs'::regclass
      and conname = 'pinetree_wallet_rail_syncs_merchant_id_rail_key'
  ) then
    alter table public.pinetree_wallet_rail_syncs
      add constraint pinetree_wallet_rail_syncs_merchant_id_rail_key
      unique using index pinetree_wallet_rail_syncs_merchant_id_rail_key;
  end if;
end $$;

grant select, insert, update, delete on table public.pinetree_wallet_rail_syncs to service_role;

notify pgrst, 'reload schema';
