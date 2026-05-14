-- Additive migration: lifecycle columns on support_tickets + support_ticket_messages table
-- Run after 20260513_support_center_foundation.sql

alter table public.support_tickets
  add column if not exists resolved_at timestamptz null,
  add column if not exists archived_at timestamptz null,
  add column if not exists last_response_at timestamptz null,
  add column if not exists merchant_email text null,
  add column if not exists merchant_business_name text null;

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  merchant_id uuid not null,
  sender_type text not null check (sender_type in ('merchant', 'pinetree', 'system')),
  sender_name text null,
  sender_email text null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_id_idx
  on public.support_ticket_messages (ticket_id);

create index if not exists support_ticket_messages_merchant_id_idx
  on public.support_ticket_messages (merchant_id);

create index if not exists support_ticket_messages_created_at_idx
  on public.support_ticket_messages (created_at);
