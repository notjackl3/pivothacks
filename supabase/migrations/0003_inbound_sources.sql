-- Composio-managed inbound accounts and idempotent trigger delivery. Run after 0002_context.sql.
-- Replaces the earlier 0002_instagram.sql / 0003_composio.sql pair: Instagram is now an inbound
-- source only (Telegram is the sole delivery channel), so no Instagram pairing table is created.
-- Every statement is idempotent: safe to re-run on a database that already had the old pair applied.

alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('slack','composio_slack','gmail','outlook','telegram','instagram','whatsapp','sms','mock'));

alter table public.connections add column if not exists display_label text;

comment on column public.connections.external_account_id is
  'slack team_id | telegram chat_id | composio connected_account_id';

-- The inbound channel a message arrived on; drives the reel/card header and the History row.
alter table public.messages add column if not exists source_provider text;
update public.messages m set source_provider = case when c.provider = 'composio_slack' then 'slack' else c.provider end
from public.connections c where c.id = m.connection_id and m.source_provider is null;
alter table public.messages alter column source_provider set not null;

create table if not exists public.composio_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  toolkit text not null,
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
alter table public.composio_sources drop constraint if exists composio_sources_toolkit_check;
alter table public.composio_sources add constraint composio_sources_toolkit_check
  check (toolkit in ('gmail','slack','outlook','whatsapp','instagram'));
create index if not exists composio_sources_user on public.composio_sources(user_id, created_at desc);

create table if not exists public.composio_events (
  event_id text primary key,
  connected_account_id text not null,
  trigger_slug text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_detail text
);

alter table public.composio_sources enable row level security;
alter table public.composio_events enable row level security;

-- The Instagram delivery experiment is retired: outbound goes through Telegram only.
drop table if exists public.instagram_pairings;
alter table public.connections drop column if exists last_inbound_at;
