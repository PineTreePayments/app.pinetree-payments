-- Strict first-deployment storage for one-time i4Go session correlation.
-- No PAN, CVV, raw token, access block, or provider payload is stored.
begin;

do $preflight$
declare
  v_name text;
begin
  if to_regclass('public.shift4_tokenization_sessions') is not null then
    raise exception 'Shift4 tokenization session objects already exist. Inspect schema drift; this strict first-deployment migration will not replace them.';
  end if;

  foreach v_name in array array[
    'consume_shift4_tokenization_session',
    'enforce_shift4_tokenization_session_ownership'
  ] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname=v_name
    ) then
      raise exception 'Shift4 tokenization function public.% already exists. Inspect schema drift.', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'shift4_tokenization_sessions_merchant_payment_idx',
    'shift4_tokenization_sessions_expiry_idx'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception 'Shift4 tokenization index public.% already exists. Inspect schema drift.', v_name;
    end if;
  end loop;

  if to_regclass('public.merchants') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.merchant_providers') is null then
    raise exception 'Shift4 tokenization sessions require public.merchants, public.payments, and public.merchant_providers';
  end if;

  if to_regprocedure('public.gen_random_uuid()') is null
     and to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'Shift4 tokenization sessions require gen_random_uuid()';
  end if;

  foreach v_name in array array['service_role','anon','authenticated'] loop
    if not exists (select 1 from pg_roles where rolname=v_name) then
      raise exception 'Shift4 tokenization sessions require database role %', v_name;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='payments'
       and column_name in ('id','merchant_id') and data_type='uuid'
     group by table_name having count(distinct column_name)=2
  ) then
    raise exception 'Shift4 tokenization requires payments.id and payments.merchant_id to be uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='merchant_providers'
       and column_name in ('id','merchant_id') and data_type='uuid'
     group by table_name having count(distinct column_name)=2
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='merchant_providers'
       and column_name='provider'
       and data_type in ('text','character varying','character')
  ) then
    raise exception 'Shift4 tokenization requires merchant_providers.id/merchant_id uuid and provider text-compatible';
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
  check (
    (status='consumed') =
    (consumed_at is not null and token_fingerprint is not null)
  ),
  check (status='consumed' or token_fingerprint is null),
  check (expires_at > created_at)
);

create index shift4_tokenization_sessions_merchant_payment_idx
  on public.shift4_tokenization_sessions(merchant_id, payment_id, created_at desc);
create index shift4_tokenization_sessions_expiry_idx
  on public.shift4_tokenization_sessions(expires_at) where status='created';

create function public.enforce_shift4_tokenization_session_ownership()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id
       or new.session_id is distinct from old.session_id
       or new.merchant_id is distinct from old.merchant_id
       or new.payment_id is distinct from old.payment_id
       or new.merchant_provider_connection_id is distinct from old.merchant_provider_connection_id
       or new.completion_secret_hash is distinct from old.completion_secret_hash
       or new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at then
      raise exception 'Shift4 tokenization ownership and financial identity are immutable' using errcode='55000';
    end if;

    if old.status <> 'created' or new.status <> 'consumed'
       or old.consumed_at is not null or old.token_fingerprint is not null
       or new.consumed_at is null or new.token_fingerprint is null then
      raise exception 'Invalid Shift4 tokenization consumption transition' using errcode='55000';
    end if;
  end if;

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
before insert or update on public.shift4_tokenization_sessions
for each row execute function public.enforce_shift4_tokenization_session_ownership();

alter table public.shift4_tokenization_sessions enable row level security;
alter table public.shift4_tokenization_sessions force row level security;
revoke all on public.shift4_tokenization_sessions from public, anon, authenticated;
revoke all on public.shift4_tokenization_sessions from service_role;
grant select on public.shift4_tokenization_sessions to service_role;
grant insert (
  session_id, merchant_id, payment_id, merchant_provider_connection_id,
  completion_secret_hash, status, expires_at
) on public.shift4_tokenization_sessions to service_role;

create function public.consume_shift4_tokenization_session(
  p_session_id uuid,
  p_merchant_id uuid,
  p_completion_secret_hash text,
  p_token_fingerprint text
) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_changed integer;
  v_stored_fingerprint text;
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
    select 1 from public.shift4_tokenization_sessions s
     where session_id=p_session_id and merchant_id=p_merchant_id
       and completion_secret_hash=p_completion_secret_hash and status='consumed'
  ) then
    select s.token_fingerprint into v_stored_fingerprint
      from public.shift4_tokenization_sessions s
     where s.session_id=p_session_id and s.merchant_id=p_merchant_id
       and s.completion_secret_hash=p_completion_secret_hash and s.status='consumed';
    if v_stored_fingerprint = p_token_fingerprint then
      return 'already_consumed';
    end if;
    return 'fingerprint_conflict';
  end if;
  return 'unavailable';
end $$;

revoke all on function public.consume_shift4_tokenization_session(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.consume_shift4_tokenization_session(uuid,uuid,text,text) from service_role;
grant execute on function public.consume_shift4_tokenization_session(uuid,uuid,text,text) to service_role;
revoke all on function public.enforce_shift4_tokenization_session_ownership() from public, anon, authenticated;
revoke all on function public.enforce_shift4_tokenization_session_ownership() from service_role;

notify pgrst, 'reload schema';

commit;
