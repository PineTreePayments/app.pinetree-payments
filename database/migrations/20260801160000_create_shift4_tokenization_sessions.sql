-- One-time i4Go session correlation. No PAN, CVV, raw token, access block, or provider payload is stored.
begin;

do $preflight$
begin
  if to_regclass('public.shift4_tokenization_sessions') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('consume_shift4_tokenization_session','enforce_shift4_tokenization_session_ownership')) then
    raise exception 'Shift4 tokenization session objects already exist. Inspect schema drift; this strict first-deployment migration will not replace them.';
  end if;
  if to_regclass('public.payments') is null or to_regclass('public.merchant_providers') is null then
    raise exception 'Shift4 tokenization sessions require public.payments and public.merchant_providers';
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    raise exception 'Shift4 tokenization sessions require the service_role database role';
  end if;
end
$preflight$;

create table public.shift4_tokenization_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique,
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  merchant_provider_connection_id uuid not null references public.merchant_providers(id) on delete restrict,
  completion_secret_hash text not null check (completion_secret_hash ~ '^[0-9a-f]{64}$'),
  token_fingerprint text null check (token_fingerprint is null or token_fingerprint ~ '^[0-9a-f]{24}$'),
  status text not null check (status in ('created','consumed','expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),
  check ((status='consumed') = (consumed_at is not null)),
  check (expires_at > created_at)
);

create index shift4_tokenization_sessions_merchant_payment_idx
  on public.shift4_tokenization_sessions(merchant_id, payment_id, created_at desc);
create index shift4_tokenization_sessions_expiry_idx
  on public.shift4_tokenization_sessions(expires_at) where status='created';

create function public.enforce_shift4_tokenization_session_ownership()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if not exists (select 1 from public.payments p where p.id=new.payment_id and p.merchant_id=new.merchant_id) then
    raise exception 'Shift4 tokenization payment ownership mismatch';
  end if;
  if not exists (
    select 1 from public.merchant_providers mp
     where mp.id=new.merchant_provider_connection_id and mp.merchant_id=new.merchant_id and mp.provider='shift4_rest'
  ) then
    raise exception 'Shift4 tokenization provider connection ownership mismatch';
  end if;
  return new;
end $$;

create trigger shift4_tokenization_session_ownership
before insert on public.shift4_tokenization_sessions
for each row execute function public.enforce_shift4_tokenization_session_ownership();

alter table public.shift4_tokenization_sessions enable row level security;
revoke all on public.shift4_tokenization_sessions from public, anon, authenticated;
grant select, insert, update on public.shift4_tokenization_sessions to service_role;

create function public.consume_shift4_tokenization_session(
  p_session_id uuid,
  p_merchant_id uuid,
  p_completion_secret_hash text,
  p_token_fingerprint text
) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_changed integer;
begin
  if p_completion_secret_hash !~ '^[0-9a-f]{64}$' or p_token_fingerprint !~ '^[0-9a-f]{24}$' then
    return 'unavailable';
  end if;
  update public.shift4_tokenization_sessions
     set status='consumed', consumed_at=clock_timestamp(), token_fingerprint=p_token_fingerprint
   where session_id=p_session_id and merchant_id=p_merchant_id and status='created'
     and expires_at > clock_timestamp()
     and completion_secret_hash=p_completion_secret_hash;
  get diagnostics v_changed = row_count;
  if v_changed=1 then return 'consumed_now'; end if;
  if exists (
    select 1 from public.shift4_tokenization_sessions
     where session_id=p_session_id and merchant_id=p_merchant_id
       and completion_secret_hash=p_completion_secret_hash and status='consumed'
  ) then return 'already_consumed'; end if;
  return 'unavailable';
end $$;

revoke all on function public.consume_shift4_tokenization_session(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.consume_shift4_tokenization_session(uuid,uuid,text,text) to service_role;
revoke all on function public.enforce_shift4_tokenization_session_ownership() from public, anon, authenticated;

commit;
