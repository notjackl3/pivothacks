-- Pivot 03 (context): the Triage Router. Run after 0001_init.sql.

alter table public.processing_jobs drop constraint processing_jobs_status_check;
alter table public.processing_jobs add constraint processing_jobs_status_check
  check (status in ('queued','analyzing','notifying','voicing','rendering','held','delivering','complete','failed'));
alter table public.processing_jobs
  add column delivery_plan jsonb,          -- DeliveryPlan (packages/shared/src/delivery.ts)
  add column deliver_after timestamptz;    -- when status='held': release time
create index processing_jobs_held on public.processing_jobs (deliver_after) where status = 'held';

alter table public.reel_artifacts add column instant_message_id text;  -- Telegram id of the instant card (mode=instant)

alter table public.tracked_entities add column relationship text not null default 'other'
  check (relationship in ('professor','employer','landlord','peer','other'));

alter table public.preferences
  add column quiet_start text not null default '22:00',
  add column quiet_end   text not null default '08:00';
