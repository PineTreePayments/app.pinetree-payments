alter table public.terminals
  add column if not exists tax_mode text not null default 'merchant_default',
  add column if not exists tax_rate numeric null,
  add column if not exists tax_label text not null default 'Sales tax';

alter table public.terminals
  alter column tax_mode set default 'merchant_default';

alter table public.terminals
  drop constraint if exists terminals_tax_mode_check;

alter table public.terminals
  add constraint terminals_tax_mode_check
  check (tax_mode in ('none', 'merchant_default', 'custom'));

alter table public.terminals
  drop constraint if exists terminals_tax_rate_check;

alter table public.terminals
  add constraint terminals_tax_rate_check
  check (
    (tax_mode = 'custom' and tax_rate > 0 and tax_rate <= 100)
    or (tax_mode <> 'custom' and tax_rate is null)
  );
