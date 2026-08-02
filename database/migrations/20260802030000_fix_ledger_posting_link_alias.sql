begin;

-- This is a forward-only replacement for the already deployed journal RPC.
-- Refuse to create a new overload if the exact installed signature is absent.
do $preflight$
begin
  if to_regprocedure(
    'public.post_ledger_transaction(text,text,text,text,uuid,text,jsonb,jsonb,text,date,timestamptz,text,text,uuid,text,integer)'
  ) is null then
    raise exception
      'Required installed function is missing: public.post_ledger_transaction(text,text,text,text,uuid,text,jsonb,jsonb,text,date,timestamptz,text,text,uuid,text,integer)';
  end if;
end
$preflight$;

create or replace function public.post_ledger_transaction(
  p_posting_key text,
  p_posting_version text,
  p_event_type text,
  p_lifecycle_domain text,
  p_merchant_id uuid,
  p_currency_or_asset text,
  p_lines jsonb,
  p_links jsonb default '[]'::jsonb,
  p_network text default '',
  p_business_date date default null,
  p_occurred_at timestamptz default null,
  p_source text default 'engine',
  p_pricing_version text default null,
  p_reversal_of_transaction_id uuid default null,
  p_unit text default 'minor',
  p_precision integer default 2
)
returns table (
  ledger_transaction_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_existing public.ledger_transactions%rowtype;
  v_id uuid;
  v_line_item jsonb;
  v_link_item jsonb;
  v_index integer := 0;
  v_currency text := upper(btrim(p_currency_or_asset));
  v_network text := coalesce(nullif(btrim(p_network), ''), '');
  v_debits bigint := 0;
  v_credits bigint := 0;
  v_amount bigint;
  v_payment_link text;
  v_link_merchant uuid;
  v_existing_identity jsonb;
  v_requested_identity jsonb;
  v_account public.ledger_accounts%rowtype;
begin
  if p_posting_key is null or length(btrim(p_posting_key)) = 0 then
    raise exception 'A posting key is required';
  end if;

  -- Lifecycle links are mandatory for money postings.
  if p_lifecycle_domain in ('payment', 'fee') then
    if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(coalesce(p_links, '[]'::jsonb)) = 0 then
      raise exception
        'A % posting requires at least one lifecycle link', p_lifecycle_domain;
    end if;

    select link_item.value ->> 'payment_id'
      into v_payment_link
      from jsonb_array_elements(p_links) as link_item(value)
     where link_item.value ->> 'link_type' = 'payment'
       and coalesce(link_item.value ->> 'payment_id', '') <> ''
     limit 1;

    if v_payment_link is null then
      raise exception
        'A % posting requires a payment link carrying payment_id', p_lifecycle_domain;
    end if;

    select p.merchant_id into v_link_merchant
      from public.payments p
     where p.id = v_payment_link::uuid;

    if not found then
      raise exception 'Lifecycle link references payment %, which does not exist', v_payment_link;
    end if;
    if v_link_merchant is distinct from p_merchant_id then
      raise exception
        'Lifecycle link references payment % belonging to another merchant', v_payment_link;
    end if;

    if exists (
      select 1
        from jsonb_array_elements(p_links) as link_item(value)
       where link_item.value ->> 'link_type' = 'payment'
         and coalesce(link_item.value ->> 'payment_id', '') <> v_payment_link
    ) then
      raise exception 'A single posting may not link to more than one payment';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(p_links) as link_item(value)
        join public.payment_events e
          on e.id = nullif(link_item.value ->> 'payment_event_id', '')::uuid
       where coalesce(link_item.value ->> 'payment_event_id', '') <> ''
         and e.payment_id <> v_payment_link::uuid
    ) then
      raise exception 'A payment-event link must belong to the linked payment';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(p_links) as link_item(value)
       where coalesce(link_item.value ->> 'payment_event_id', '') <> ''
         and not exists (
           select 1 from public.payment_events e
            where e.id = (link_item.value ->> 'payment_event_id')::uuid
         )
    ) then
      raise exception 'A payment-event link references an event that does not exist';
    end if;
  end if;

  -- Validate the complete line set before writing.
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal transaction requires at least two entry lines';
  end if;

  for v_line_item in
    select line_item.value
      from jsonb_array_elements(p_lines) as line_item(value)
  loop
    v_amount := (v_line_item ->> 'amount_minor')::bigint;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Journal entry amounts must be positive integers; got %', v_amount;
    end if;
    if (v_line_item ->> 'side') = 'debit' then
      v_debits := v_debits + v_amount;
    elsif (v_line_item ->> 'side') = 'credit' then
      v_credits := v_credits + v_amount;
    else
      raise exception 'Journal entry side must be debit or credit; got %', v_line_item ->> 'side';
    end if;

    select * into v_account
      from public.ledger_accounts a
     where a.id = (v_line_item ->> 'account_id')::uuid;

    if not found then
      raise exception 'Journal entry references account %, which does not exist',
        v_line_item ->> 'account_id';
    end if;
    if v_account.status <> 'active' then
      raise exception 'Journal entry references account %, which is %',
        v_account.id, v_account.status;
    end if;
    if v_account.currency_or_asset <> v_currency then
      raise exception
        'Journal entry account % is denominated in % but the transaction is in %',
        v_account.id, v_account.currency_or_asset, v_currency;
    end if;
    if v_account.network is distinct from v_network then
      raise exception
        'Journal entry account % is on network % but the transaction is on %',
        v_account.id, coalesce(nullif(v_account.network, ''), '(none)'),
        coalesce(nullif(v_network, ''), '(none)');
    end if;
    if v_account.unit is distinct from p_unit
       or v_account.precision is distinct from p_precision then
      raise exception
        'Journal entry account % has unit/precision %/% but the transaction requires %/%',
        v_account.id, v_account.unit, v_account.precision, p_unit, p_precision;
    end if;
  end loop;

  if v_debits <> v_credits then
    raise exception
      'Journal transaction is unbalanced: debits % <> credits %', v_debits, v_credits;
  end if;

  -- Insert first so the unique posting key serializes idempotent callers.
  begin
    insert into public.ledger_transactions (
      posting_key, posting_version, event_type, lifecycle_domain,
      business_date, occurred_at, received_at, source,
      merchant_id, currency_or_asset, network, pricing_version,
      reversal_of_transaction_id
    ) values (
      p_posting_key, p_posting_version, p_event_type, p_lifecycle_domain,
      coalesce(p_business_date, (coalesce(p_occurred_at, now()) at time zone 'utc')::date),
      p_occurred_at, now(), p_source,
      p_merchant_id, v_currency, v_network, p_pricing_version,
      p_reversal_of_transaction_id
    )
    returning id into v_id;
  exception
    when unique_violation then
      select * into v_existing
        from public.ledger_transactions t
       where t.posting_key = p_posting_key
         for update;

      if not found then
        raise exception
          'Posting key % conflicted but its transaction is not visible', p_posting_key;
      end if;

      if v_existing.posting_version is distinct from p_posting_version
         or v_existing.event_type is distinct from p_event_type
         or v_existing.lifecycle_domain is distinct from p_lifecycle_domain
         or v_existing.merchant_id is distinct from p_merchant_id
         or v_existing.currency_or_asset is distinct from v_currency
         or v_existing.network is distinct from v_network
         or v_existing.pricing_version is distinct from p_pricing_version
         or v_existing.reversal_of_transaction_id
            is distinct from p_reversal_of_transaction_id then
        raise exception
          'Posting key % was already used for a different economic event', p_posting_key;
      end if;

      select coalesce(jsonb_agg(line order by line), '[]'::jsonb) into v_existing_identity
        from (
          select jsonb_build_object(
                   'account_id', e.account_id,
                   'side', e.side,
                   'amount_minor', e.amount_minor,
                   'memo', coalesce(e.memo, '')
                 ) as line
            from public.ledger_journal_entries e
           where e.ledger_transaction_id = v_existing.id
        ) existing_lines;

      select coalesce(jsonb_agg(line order by line), '[]'::jsonb) into v_requested_identity
        from (
          select jsonb_build_object(
                   'account_id', (line_item.value ->> 'account_id')::uuid,
                   'side', line_item.value ->> 'side',
                   'amount_minor', (line_item.value ->> 'amount_minor')::bigint,
                   'memo', coalesce(line_item.value ->> 'memo', '')
                 ) as line
            from jsonb_array_elements(p_lines) as line_item(value)
        ) requested_lines;

      if v_existing_identity is distinct from v_requested_identity then
        raise exception
          'Posting key % was already used with different journal lines', p_posting_key;
      end if;

      select coalesce(jsonb_agg(link order by link), '[]'::jsonb) into v_existing_identity
        from (
          select jsonb_build_object(
                   'link_type', k.link_type,
                   'record_id', k.record_id,
                   'payment_id', coalesce(k.payment_id::text, ''),
                   'payment_attempt_id', coalesce(k.payment_attempt_id, ''),
                   'payment_event_id', coalesce(k.payment_event_id::text, '')
                 ) as link
            from public.ledger_links k
           where k.ledger_transaction_id = v_existing.id
        ) existing_links;

      select coalesce(jsonb_agg(link order by link), '[]'::jsonb) into v_requested_identity
        from (
          select jsonb_build_object(
                   'link_type', link_item.value ->> 'link_type',
                   'record_id', link_item.value ->> 'record_id',
                   'payment_id', coalesce(link_item.value ->> 'payment_id', ''),
                   'payment_attempt_id', coalesce(link_item.value ->> 'payment_attempt_id', ''),
                   'payment_event_id', coalesce(link_item.value ->> 'payment_event_id', '')
                 ) as link
            from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as link_item(value)
        ) requested_links;

      if v_existing_identity is distinct from v_requested_identity then
        raise exception
          'Posting key % was already used with different lifecycle links', p_posting_key;
      end if;

      return query select v_existing.id, false;
      return;
  end;

  for v_line_item in
    select line_item.value
      from jsonb_array_elements(p_lines) as line_item(value)
  loop
    v_index := v_index + 1;
    insert into public.ledger_journal_entries (
      ledger_transaction_id, account_id, line_number, side,
      amount_minor, currency_or_asset, network, memo
    ) values (
      v_id,
      (v_line_item ->> 'account_id')::uuid,
      v_index,
      v_line_item ->> 'side',
      (v_line_item ->> 'amount_minor')::bigint,
      v_currency,
      v_network,
      v_line_item ->> 'memo'
    );
  end loop;

  for v_link_item in
    select link_item.value
      from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as link_item(value)
  loop
    insert into public.ledger_links (
      ledger_transaction_id, merchant_id, link_type, record_id,
      payment_id, payment_attempt_id, payment_event_id
    ) values (
      v_id,
      p_merchant_id,
      v_link_item ->> 'link_type',
      v_link_item ->> 'record_id',
      nullif(v_link_item ->> 'payment_id', '')::uuid,
      nullif(v_link_item ->> 'payment_attempt_id', ''),
      nullif(v_link_item ->> 'payment_event_id', '')::uuid
    );
  end loop;

  return query select v_id, true;
end
$function$;

alter function public.post_ledger_transaction(
  text, text, text, text, uuid, text, jsonb, jsonb,
  text, date, timestamptz, text, text, uuid, text, integer
) owner to postgres;

revoke all on function public.post_ledger_transaction(
  text, text, text, text, uuid, text, jsonb, jsonb,
  text, date, timestamptz, text, text, uuid, text, integer
) from public, anon, authenticated, service_role;

grant execute on function public.post_ledger_transaction(
  text, text, text, text, uuid, text, jsonb, jsonb,
  text, date, timestamptz, text, text, uuid, text, integer
) to service_role;

notify pgrst, 'reload schema';

commit;
