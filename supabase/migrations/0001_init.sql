create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  target_language text not null default 'zh-CN',
  timezone text not null default 'America/Toronto',
  reply_tone text not null default 'respectful_student'
    check (reply_tone in ('respectful_student','concise_professional','warm','direct')),
  updated_at timestamptz not null default now()
);
-- Dropped from MVP: voice_id, visual_style, playback_speed, sensitive_mode (see §21).

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('slack','telegram','mock')),
  external_account_id text not null,        -- slack team_id | telegram chat_id
  external_user_id text,                    -- slack authed user id
  encrypted_access_token text,              -- iv:tag:ciphertext base64
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','revoked','error')),
  mode text not null default 'user_token' check (mode in ('user_token','bot_token')),
  created_at timestamptz not null default now(),
  unique (user_id, provider, external_account_id)
);
create index connections_lookup on public.connections (provider, external_account_id, external_user_id);

create table public.tracked_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  entity_type text not null check (entity_type in ('person','channel')),
  external_entity_id text not null,
  display_name text not null,
  enabled boolean not null default true,
  unique (connection_id, entity_type, external_entity_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  external_message_id text not null,        -- `${channel}:${ts}`
  external_channel_id text not null,
  external_thread_id text,                  -- thread_ts if inside a thread
  sender_external_id text not null,
  sender_display_name text not null,
  original_text text not null,
  received_at timestamptz not null,
  is_mock boolean not null default false,
  created_at timestamptz not null default now(),
  unique (connection_id, external_message_id)
);
create index messages_user_recent on public.messages (user_id, received_at desc);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','analyzing','voicing','rendering','delivering','complete','failed')),
  attempt_count int not null default 0,
  error_code text, error_detail text,
  stage_timings jsonb not null default '{}'::jsonb,   -- {"analyzing":11200,"voicing":6100,...} ms
  started_at timestamptz, completed_at timestamptz, updated_at timestamptz not null default now()
);

create table public.reel_artifacts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages(id) on delete cascade,
  interpretation_json jsonb not null,
  audio_path text, video_path text,
  duration_ms int,
  render_mode text not null check (render_mode in ('remotion','captions_only','text_only')),
  delivery_message_id text,
  created_at timestamptz not null default now()
);

create table public.reply_drafts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  user_input_original text not null,
  draft_english text not null,
  meaning_check text,
  tone text not null,
  status text not null default 'draft'
    check (status in ('draft','approved','sent','send_uncertain','cancelled','failed')),
  approved_at timestamptz,
  sent_external_message_id text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reply_drafts_message on public.reply_drafts (message_id, created_at desc);

create table public.telegram_pairings (
  code text primary key, user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null, used_at timestamptz
);

create table public.telegram_sessions (
  chat_id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  state text not null default 'idle' check (state in ('idle','awaiting_reply')),
  active_message_id uuid references public.messages(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['users','preferences','connections','tracked_entities','messages','processing_jobs','reel_artifacts','reply_drafts','telegram_pairings','telegram_sessions']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  insert into public.preferences (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
