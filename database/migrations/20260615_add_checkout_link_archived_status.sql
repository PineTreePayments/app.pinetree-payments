alter table public.checkout_links
  drop constraint if exists checkout_links_status_check;

alter table public.checkout_links
  add constraint checkout_links_status_check
  check (status in ('active', 'disabled', 'archived'));

create index if not exists checkout_links_merchant_status_created_idx
  on public.checkout_links (merchant_id, status, created_at desc);

comment on column public.checkout_links.status is
  'Merchant lifecycle state. Expiration remains derived from expires_at; archived links are retained for historical session and payment references.';
