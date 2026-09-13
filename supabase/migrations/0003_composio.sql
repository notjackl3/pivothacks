-- Composio-managed inbound accounts and idempotent trigger delivery.
alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('slack','composio_slack','gmail','outlook','telegram','instagram','whatsapp','sms','mock'));

alter table public.messages add column if not exists source_provider text;
update public.messages m set source_provider = case when c.provider = 'composio_slack' then 'slack' else c.provider end
from public.connections c where c.id = m.connection_id and m.source_provider is null;
alter table public.messages alter column source_provider set not null;

create table public.composio_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  toolkit text not null check (toolkit in ('gmail','slack','outlook','whatsapp')),
  auth_config_id text not null,
  connected_account_id text not null unique,
  trigger_id text,
  trigger_slug text not null,
  status text not null default 'pending' check (status in ('pending','active','expired','error')),
  label text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, toolkit, connected_account_id)
);
create index composio_sources_user on public.composio_sources(user_id, created_at desc);

create table public.composio_events (
  event_id text primary key,
  connected_account_id text not null,
  trigger_slug text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_detail text
);

alter table public.composio_sources enable row level security;
alter table public.composio_events enable row level security;
