-- Instagram delivery support. Apply after 0001_init.sql.
alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('slack','telegram','instagram','whatsapp','sms','mock'));

alter table public.connections add column if not exists display_label text;
alter table public.connections add column if not exists last_inbound_at timestamptz;

create table if not exists public.instagram_pairings (
  code text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.instagram_pairings enable row level security;

comment on column public.connections.external_account_id is
  'slack team_id | telegram chat_id | Instagram-scoped recipient id';
