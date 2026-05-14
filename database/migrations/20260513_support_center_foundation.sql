create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  user_id uuid null,
  category text not null,
  subject text not null,
  description text not null,
  priority text not null default 'normal',
  status text not null default 'open',
  related_payment_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_merchant_id_idx
  on support_tickets (merchant_id);

create index if not exists support_tickets_status_idx
  on support_tickets (status);

create index if not exists support_tickets_created_at_idx
  on support_tickets (created_at);

create index if not exists support_tickets_related_payment_id_idx
  on support_tickets (related_payment_id);

create table if not exists merchant_feedback (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  user_id uuid null,
  type text not null,
  message text not null,
  rating int null,
  created_at timestamptz not null default now()
);

create index if not exists merchant_feedback_merchant_id_idx
  on merchant_feedback (merchant_id);

create index if not exists merchant_feedback_created_at_idx
  on merchant_feedback (created_at);
