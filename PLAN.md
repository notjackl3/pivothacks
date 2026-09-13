# ReelRelay — Implementation Plan (12-hour hackathon)

Source of truth: the Claude Build Brief. This plan is the executable version of it. Every decision below is final for the hackathon unless a task's acceptance criteria cannot be met, in which case the listed fallback applies.

---

## 1. Executive summary and final MVP boundary

**ReelRelay** turns important incoming Slack messages from senders a student explicitly tracks into short, translated, captioned 9:16 videos delivered to Telegram, then helps the student reply in their own language with an English draft in a chosen tone. Nothing is ever sent back to Slack without an explicit `Send` tap.

**MVP boundary (ship this, nothing more):**

| In | Out |
| --- | --- |
| Email magic-link sign-in (Supabase Auth) | Password auth, social login |
| Real Slack OAuth (user token) + Events API | Gmail, Instagram, Discord, WhatsApp (adapter interfaces only) |
| Track specific Slack people (DMs) and channels | Threads as tracked entities |
| Telegram bot pairing via one-time code | QR code (stretch, trivial if time allows) |
| Preferences: language, voice, visual style, tone, pace, sensitive mode | Per-sender preference overrides |
| Claude structured interpretation (Zod-validated) | Urgency reminders, comprehension quiz |
| ElevenLabs TTS with character timestamps | Voice cloning, voice-note replies |
| One Remotion template, two procedural backgrounds (playful, calm) | AI-generated backgrounds, licensed gameplay footage |
| Telegram `sendVideo` + inline buttons | Telegram Mini App |
| Reply draft with `Send` / `Edit` / `Regenerate` / `Cancel` | Auto-send, scheduled send |
| Threaded reply into Slack as the user | Replying into channels the user cannot post in |
| History page with job status and retry | Analytics, multi-user admin |
| Demo event injector + backup video | Production deployment hardening |

**Key assumptions (stated once, used everywhere):**

1. The whole backend (API, Slack webhook, Telegram bot, worker) runs as **one Node process** on a team laptop behind ngrok during judging. Vercel hosts only the web app if time allows. An in-memory queue is the default; BullMQ is a drop-in behind the same `Queue` interface.
2. Slack is authorized with a **user token** so the app sees the student's own DMs from the professor and posts replies *as the student*. Bot-token "invite the bot to a channel" mode is the fallback if user-scope events fail in hour 1.
3. The demo "professor" is a second Slack account in a team-owned free workspace.
4. Target reel length is 20–35 s; hard cap 45 s; captions are burned in; MP4 ≤ 20 MB.
5. Team size 3 is the planning baseline; section 17 covers 2 and 4.

---

## 2. Challenge-alignment matrix

### Challenge 1 — Communication Breakdown

> Important information is often misunderstood, ignored, or missed because it is communicated in the wrong format, place, tone, or moment.

| Breakdown | Where in the MVP it is addressed | Demo proof |
| --- | --- | --- |
| Wrong format | `packages/reel` renders dense text into narrated, captioned vertical video | Play the reel |
| Wrong place | `DeliveryConnector` (Telegram) delivers to the channel the student chose | Message appears in Telegram, not buried in Slack |
| Wrong tone | `senderIntent` + `tone` in interpretation; reply drafted in chosen tone | Show `senderIntent`, then respectful draft |
| Wrong moment | `urgency` detected and shown as chip; deadline pinned in action card | "Friday 5 PM" action frame |
| Language barrier | `faithfulTranslation` + `spokenSummary` in target language | Mandarin narration |
| Information loss | `Original` button always shows exact source text; `preservedFacts` list; `ambiguities` flagged | Tap `Original`, tap `Key actions`, see "do NOT upload archive" |

### Challenge 2 — University student living independently

> Your primary user is now a university student living independently for the first time. They are suddenly communicating with professors, employers, landlords, roommates, clubs, services, and unfamiliar institutions. Adapt your solution around that reality.

| Student reality | MVP response |
| --- | --- |
| Many unfamiliar counterparties with different power dynamics | Per-sender tracking; reply tones `respectful_student`, `concise_professional`, `warm`, `direct` |
| High-stakes institutional messages (housing, grades, pay) | `sensitive` tone forces calm background; `preservedFacts` keeps amounts, dates, addresses exact; disclaimer that ReelRelay does not make legal/academic/housing decisions |
| First time handling deadlines alone | Every action item carries `dueAt` + `evidenceQuote`; final action frame in the reel |
| Fear of replying wrongly in a second language | Draft shows user's original input next to English draft; nothing sends without approval |
| Fixtures | Professor deadline change, landlord rent documentation, manager multi-step task, club/service message with ambiguous date |

> **BLOCKER (visible on purpose):** Challenge 2's *judging criteria* have not been supplied. The statement above is verbatim from the brief; no criteria are invented here. When criteria arrive, add a row per criterion to this table before the final rehearsal (task 26).

---

## 3. Final stack choices

| Layer | Choice | Responsibility | External account / key | Review, billing, or approval risk |
| --- | --- | --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo, TypeScript 5, Node 20 | Shared types, one `pnpm dev` | none | none |
| Web app | Next.js 15 (App Router) + Tailwind + shadcn/ui | Onboarding, connections, tracking, preferences, history | Vercel (optional) | none |
| API + webhooks + worker | Fastify 5 in `apps/server`, single process | Slack OAuth/events, Telegram bot, REST API, job worker | none | none |
| Auth + DB + storage | Supabase (Postgres, Auth magic link, Storage private bucket `reels`) | Users, all tables, artifact storage with signed URLs | Supabase project (free tier) | free tier is enough |
| Queue | In-memory queue behind `Queue` interface; BullMQ + Redis optional | Async reel generation | Upstash Redis (optional) | none |
| Slack | `@slack/oauth`, `@slack/web-api`, raw Fastify route for events (not Bolt, to control ack timing) | OAuth user token, events, `chat.postMessage` | Slack app in team workspace | **Workspace admin approval** may be required on managed workspaces; use a team-owned workspace |
| Telegram | Telegraf 4, long polling in dev/demo, webhook optional | Pairing, `sendVideo`, inline buttons, reply capture | Bot token from @BotFather | none |
| LLM | Anthropic Claude `claude-opus-5` via `@anthropic-ai/sdk`, `messages.parse` + `zodOutputFormat` | Interpretation JSON, reply drafts | `ANTHROPIC_API_KEY` | **Paid API** |
| TTS | ElevenLabs `eleven_multilingual_v2`, `/with-timestamps` endpoint | Voiceover + character alignment for captions | ElevenLabs key | **Paid** beyond free tier; fallback: OpenAI `tts-1` (no timestamps) or captions-only |
| Video | Remotion 4 (`@remotion/renderer`) with FFmpeg fallback | 1080x1920 MP4, burned captions | none | **Remotion license**: free for individuals and companies ≤ 3 people; note if team is a company |
| Backgrounds | Two procedural Remotion scenes (no video files) + optional Pexels-licensed loop | "Playful" and "Calm" | none | Pexels license permits use without attribution; record source URL anyway |
| Tunnel | ngrok (reserved domain if available) | Stable Slack redirect + events URL | ngrok account | free tier random URL changes on restart; reserve one |
| Validation | Zod 3 in `packages/shared` | All contracts | none | none |
| Tests | Vitest | Unit + integration | none | none |

Node version pinned in `.nvmrc` (`20`). FFmpeg installed via `brew install ffmpeg` on each dev machine (Remotion bundles its own, FFmpeg is for fallback and `ffprobe`).

---

## 4. Architecture and sequences

### 4.1 Component diagram

```text
┌──────────────┐   OAuth redirect    ┌──────────────────────────────────────────────┐
│  apps/web    │ ─────────────────▶  │ apps/server (Fastify, one process)           │
│  Next.js     │ ◀── REST /api/* ──  │  ├─ routes/api/*          (session-auth REST) │
└──────────────┘                     │  ├─ routes/webhooks/slack (verify, ack, enqueue)│
                                     │  ├─ telegram/bot          (Telegraf polling)  │
       Slack Events ───────────────▶ │  ├─ queue/                (in-memory | BullMQ) │
       Telegram updates ───────────▶ │  └─ worker/generateReel   (analyze→tts→render→deliver)
                                     └───────┬─────────────┬─────────────┬───────────┘
                                             │             │             │
                                      Supabase PG    Supabase Storage   Anthropic / ElevenLabs
```

Four stable interfaces live in `packages/shared/src/interfaces.ts` exactly as in the brief (`SourceConnector`, `DeliveryConnector`, `ComprehensionEngine`, `ReelRenderer`). Implementations: `SlackConnector`, `TelegramDelivery`, `ClaudeEngine`, `RemotionRenderer` (+ `FfmpegRenderer` fallback). `MockSourceConnector` backs the demo injector.

### 4.2 Sequence: incoming Slack message

```text
Slack ──POST /webhooks/slack/events──▶ server
  1. verify X-Slack-Request-Timestamp within 5 min, HMAC v0 signature (raw body)
  2. url_verification? → return challenge
  3. respond 200 {} immediately (setImmediate for the rest)
  4. ignore: bot_id present, subtype in [message_changed, message_deleted, bot_message, channel_join...]
  5. lookup connection by team_id + authed_users[0]/authorizations[0].user_id
  6. tracked_entities match: entity_type=person & external_entity_id=event.user
                            OR entity_type=channel & external_entity_id=event.channel
  7. INSERT messages ON CONFLICT (connection_id, external_message_id) DO NOTHING
     (external_message_id = `${channel}:${ts}`) → if 0 rows, stop (duplicate / retry)
  8. INSERT processing_jobs(status=queued) ; queue.add('generate_reel', {messageId})
```

### 4.3 Sequence: reel generation (worker)

```text
generate_reel(messageId)
  status=analyzing  → ClaudeEngine.analyze()  → zod parse → on fail, retry once with errors → store interpretation_json
  status=voicing    → ElevenLabs with-timestamps → mp3 + char alignment → captionSegments recomputed from alignment
                      on TTS failure → captions-only (estimated timing), audio_url=null
  status=rendering  → RemotionRenderer.render() (timeout 120 s) → on fail FfmpegRenderer → on fail text-card-only
  upload            → Supabase Storage reels/{userId}/{messageId}.mp4 → signed URL (1 h)
  status=delivering → Telegram sendVideo (file stream) + inline keyboard [Original][Key actions][Reply][I understood]
  status=complete   → reel_artifacts.delivery_message_id
  any error         → status=failed, error_code, attempt_count++ ; retryable via POST /api/messages/:id/retry
```

### 4.4 Sequence: reply

```text
User taps [Reply] on reel  → telegram_sessions.state='awaiting_reply', active_message_id
User sends text (any language)
  → ClaudeEngine.draftReply(context, text, tone) → reply_drafts(status=draft)
  → bot sends: "You wrote: …\n\nEnglish draft (tone: respectful student):\n…"
     keyboard [Send][Edit][Regenerate tone ▾][Cancel]
[Send]   → POST approve → SlackConnector.sendReply (thread_ts = original ts if in thread, else channel) → status=sent, sent_external_message_id → bot confirms
[Edit]   → state='editing_draft' → next text replaces draft_english → re-show keyboard
[Regen]  → show tone picker → new draft row (old = cancelled)
[Cancel] → status=cancelled, state='idle'
```

---

## 5. Repository directory tree

```text
reelrelay/
├─ package.json                  # pnpm workspaces, turbo scripts
├─ pnpm-workspace.yaml
├─ turbo.json
├─ .nvmrc                        # 20
├─ .env.example
├─ PLAN.md
├─ README.md
├─ apps/
│  ├─ web/                       # Next.js 15
│  │  ├─ app/
│  │  │  ├─ page.tsx                       # landing
│  │  │  ├─ (auth)/login/page.tsx
│  │  │  ├─ (app)/layout.tsx               # requires session
│  │  │  ├─ (app)/connections/page.tsx
│  │  │  ├─ (app)/tracking/page.tsx
│  │  │  ├─ (app)/preferences/page.tsx
│  │  │  └─ (app)/history/page.tsx, history/[id]/page.tsx
│  │  ├─ components/ (ConnectionCard, EntityList, PreferenceForm, JobStatusBadge, ReelPlayer)
│  │  ├─ lib/api.ts                        # typed fetch to apps/server
│  │  ├─ lib/supabase/{client,server}.ts
│  │  └─ middleware.ts                     # session refresh
│  └─ server/                    # Fastify
│     ├─ src/index.ts                      # boot: fastify + telegram bot + worker
│     ├─ src/config.ts                     # zod-validated env
│     ├─ src/db/{client.ts,queries/*.ts}
│     ├─ src/auth/requireUser.ts           # Supabase JWT → userId
│     ├─ src/routes/api/{integrations,slack,entities,telegram,messages,replies,preferences,demo}.ts
│     ├─ src/routes/webhooks/slack.ts
│     ├─ src/connectors/slack/{SlackConnector.ts,verify.ts,normalize.ts,oauth.ts}
│     ├─ src/connectors/mock/MockSourceConnector.ts
│     ├─ src/delivery/telegram/{TelegramDelivery.ts,bot.ts,keyboards.ts,session.ts}
│     ├─ src/engine/{ClaudeEngine.ts,prompts.ts,factCheck.ts}
│     ├─ src/tts/{elevenlabs.ts,timing.ts}
│     ├─ src/render/{RemotionRenderer.ts,FfmpegRenderer.ts,upload.ts}
│     ├─ src/queue/{Queue.ts,memoryQueue.ts,bullQueue.ts}
│     ├─ src/worker/generateReel.ts
│     └─ test/ (verify.test.ts, normalize.test.ts, filter.test.ts, schema.test.ts, factCheck.test.ts, approval.test.ts)
├─ packages/
│  ├─ shared/                    # zod schemas + types + interfaces
│  │  └─ src/{index.ts,interpretation.ts,messages.ts,preferences.ts,api.ts,interfaces.ts}
│  └─ reel/                      # Remotion project
│     ├─ src/{Root.tsx,ReelComposition.tsx,backgrounds/{Playful.tsx,Calm.tsx},Captions.tsx,ActionCard.tsx,Chip.tsx}
│     ├─ remotion.config.ts
│     └─ public/fonts/NotoSansSC-Bold.ttf, NotoSans-Bold.ttf (CJK + Latin)
├─ supabase/
│  └─ migrations/0001_init.sql
├─ fixtures/
│  ├─ slack/professor_deadline.json, landlord_docs.json, manager_steps.json, ambiguous_date.json, bilingual.json, negation.json
│  └─ expected/*.json           # preserved facts per fixture
└─ scripts/
   ├─ inject-demo.ts             # POST fixture to /api/demo/inject
   └─ smoke-e2e.ts               # measures latency message→delivered
```

---

## 6. Environment variable template

`.env.example` (placeholders only; copy to `apps/server/.env` and `apps/web/.env.local`):

```bash
# ---- shared ----
NODE_ENV=development
APP_BASE_URL=http://localhost:3000            # web
API_BASE_URL=https://your-subdomain.ngrok.app # server public URL (ngrok)
PORT=4000

# ---- Supabase ----
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...placeholder
SUPABASE_SERVICE_ROLE_KEY=eyJ...placeholder   # server only, never in web
SUPABASE_STORAGE_BUCKET=reels
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...placeholder
NEXT_PUBLIC_API_BASE_URL=https://your-subdomain.ngrok.app

# ---- Slack ----
SLACK_CLIENT_ID=0000000000.0000000000
SLACK_CLIENT_SECRET=placeholder
SLACK_SIGNING_SECRET=placeholder
SLACK_REDIRECT_URI=https://your-subdomain.ngrok.app/api/integrations/slack/callback
SLACK_USER_SCOPES=channels:history,groups:history,im:history,mpim:history,channels:read,groups:read,im:read,mpim:read,users:read,chat:write

# ---- Telegram ----
TELEGRAM_BOT_TOKEN=000000:placeholder
TELEGRAM_MODE=polling                         # polling | webhook
TELEGRAM_WEBHOOK_SECRET=placeholder-random-32

# ---- AI ----
ANTHROPIC_API_KEY=sk-ant-placeholder
ANTHROPIC_MODEL=claude-opus-5
ELEVENLABS_API_KEY=placeholder
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_DEFAULT_VOICE_ID=placeholder

# ---- security ----
TOKEN_ENCRYPTION_KEY=base64-32-bytes-placeholder   # AES-256-GCM for provider tokens
DEMO_INJECT_SECRET=placeholder                     # required header for /api/demo/inject

# ---- optional ----
REDIS_URL=                                    # set to use BullMQ instead of memory queue
RENDER_TIMEOUT_MS=120000
REEL_MAX_SECONDS=45
```

---

## 7. Database schema (Supabase Postgres)

`supabase/migrations/0001_init.sql`:

```sql
create extension if not exists pgcrypto;

-- users mirror auth.users
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table public.preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  target_language text not null default 'zh-CN',
  voice_id text not null default 'default',
  visual_style text not null default 'playful' check (visual_style in ('playful','calm')),
  reply_tone text not null default 'respectful_student'
    check (reply_tone in ('respectful_student','concise_professional','warm','direct')),
  playback_speed numeric(3,2) not null default 1.00 check (playback_speed between 0.8 and 1.3),
  sensitive_mode boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('slack','telegram','gmail','instagram','mock')),
  external_account_id text not null,        -- slack: team_id ; telegram: chat_id
  external_user_id text,                    -- slack: authed user id
  encrypted_access_token text,              -- AES-256-GCM base64 (iv:tag:ciphertext)
  encrypted_refresh_token text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','revoked','error')),
  created_at timestamptz not null default now(),
  unique (user_id, provider, external_account_id)
);
create index connections_provider_account_idx on public.connections (provider, external_account_id);

create table public.tracked_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  entity_type text not null check (entity_type in ('person','channel','thread')),
  external_entity_id text not null,
  display_name text not null,
  enabled boolean not null default true,
  unique (connection_id, entity_type, external_entity_id)
);
create index tracked_entities_lookup_idx on public.tracked_entities (connection_id, external_entity_id) where enabled;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  external_message_id text not null,        -- `${channel}:${ts}`
  external_thread_id text,                  -- thread_ts if any
  external_channel_id text not null,
  sender_external_id text not null,
  sender_display_name text not null,
  original_text text not null,
  source_language text,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (connection_id, external_message_id)
);
create index messages_user_recent_idx on public.messages (user_id, received_at desc);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','analyzing','voicing','rendering','delivering','complete','failed')),
  attempt_count int not null default 0,
  error_code text,
  error_detail text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index processing_jobs_one_per_message on public.processing_jobs (message_id);

create table public.reel_artifacts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  interpretation_json jsonb not null,
  audio_path text,                          -- storage path, null if captions-only
  video_path text,                          -- storage path, null if text-card-only
  duration_ms int,
  render_mode text not null check (render_mode in ('remotion','ffmpeg','captions_only','text_only')),
  delivery_message_id text,                 -- telegram message_id
  created_at timestamptz not null default now(),
  unique (message_id)
);

create table public.reply_drafts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  user_input_original text not null,
  user_input_language text,
  draft_english text not null,
  tone text not null,
  status text not null default 'draft'
    check (status in ('draft','approved','sent','cancelled','failed')),
  sent_external_message_id text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reply_drafts_message_idx on public.reply_drafts (message_id, created_at desc);

create table public.telegram_pairings (
  code text primary key,                    -- 6 chars, uppercase
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table public.telegram_sessions (
  chat_id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  state text not null default 'idle' check (state in ('idle','awaiting_reply','editing_draft','choosing_tone')),
  active_message_id uuid references public.messages(id) on delete set null,
  active_draft_id uuid references public.reply_drafts(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- RLS: server uses service role; web reads only via server API. Enable RLS to block anon access.
alter table public.users enable row level security;
alter table public.preferences enable row level security;
alter table public.connections enable row level security;
alter table public.tracked_entities enable row level security;
alter table public.messages enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.reel_artifacts enable row level security;
alter table public.reply_drafts enable row level security;
alter table public.telegram_pairings enable row level security;
alter table public.telegram_sessions enable row level security;

-- trigger: create users row + default preferences on signup
create or replace function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  insert into public.preferences (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

Storage: private bucket `reels`; server generates signed URLs (`createSignedUrl`, 3600 s) for the web history page. Telegram receives the file as a stream, not a URL.

---

## 8. Shared TypeScript types and Zod contracts

`packages/shared/src/interpretation.ts`:

```ts
import { z } from "zod";

export const ToneSchema = z.enum(["friendly", "neutral", "urgent", "strict", "sensitive"]);
export const UrgencySchema = z.enum(["low", "medium", "high"]);
export const ReplyToneSchema = z.enum(["respectful_student", "concise_professional", "warm", "direct"]);
export const VisualStyleSchema = z.enum(["playful", "calm"]);

export const CaptionSegmentSchema = z.object({
  text: z.string().min(1).max(90),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});

export const MessageInterpretationSchema = z.object({
  sourceLanguage: z.string(),                 // BCP-47, e.g. "en"
  targetLanguage: z.string(),
  faithfulTranslation: z.string().min(1),
  spokenSummary: z.string().min(1).max(600),  // ~35 s of speech
  shortTitle: z.string().min(1).max(60),
  hook: z.string().min(1).max(80),
  senderIntent: z.string().min(1).max(300),
  tone: ToneSchema,
  urgency: UrgencySchema,
  actionItems: z.array(z.object({
    text: z.string().min(1),
    dueAt: z.string().nullable(),             // ISO 8601 or null; never guessed
    dueText: z.string().nullable(),           // verbatim from message, e.g. "Friday at 5:00 PM"
    evidenceQuote: z.string().min(1),         // must be substring of original
  })).max(8),
  preservedFacts: z.array(z.object({ label: z.string(), value: z.string() })).max(20),
  ambiguities: z.array(z.string()).max(6),
  suggestedClarifyingQuestions: z.array(z.string()).max(4),
  isSensitive: z.boolean(),
  // captionSegments are produced by the timing step, not by the LLM. LLM returns spokenSegments (text only, ordered).
  spokenSegments: z.array(z.string().min(1).max(90)).min(2).max(24),
});
export type MessageInterpretation = z.infer<typeof MessageInterpretationSchema>;

export const TimedInterpretationSchema = MessageInterpretationSchema.extend({
  captionSegments: z.array(CaptionSegmentSchema).min(1),
  durationMs: z.number().int().positive(),
});
export type TimedInterpretation = z.infer<typeof TimedInterpretationSchema>;

export const ReplyDraftOutputSchema = z.object({
  detectedInputLanguage: z.string(),
  draftEnglish: z.string().min(1).max(1500),
  meaningCheck: z.string().max(300),          // one sentence in the user's language: "This says: …"
  warnings: z.array(z.string()).max(3),       // e.g. "You did not answer the Wednesday question"
});
export type ReplyDraftOutput = z.infer<typeof ReplyDraftOutputSchema>;
```

`packages/shared/src/messages.ts`:

```ts
export const NormalizedMessageSchema = z.object({
  provider: z.enum(["slack", "mock"]),
  connectionId: z.string().uuid(),
  externalMessageId: z.string(),
  externalThreadId: z.string().nullable(),
  externalChannelId: z.string(),
  senderExternalId: z.string(),
  senderDisplayName: z.string(),
  text: z.string().min(1),
  receivedAt: z.string().datetime(),
});
export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>;

export const UserPreferencesSchema = z.object({
  targetLanguage: z.string(),
  voiceId: z.string(),
  visualStyle: VisualStyleSchema,
  replyTone: ReplyToneSchema,
  playbackSpeed: z.number().min(0.8).max(1.3),
  sensitiveMode: z.boolean(),
});

export const JobStatusSchema = z.enum(["queued","analyzing","voicing","rendering","delivering","complete","failed"]);

export type ReelArtifact = {
  messageId: string;
  videoPath: string | null;
  audioPath: string | null;
  durationMs: number | null;
  renderMode: "remotion" | "ffmpeg" | "captions_only" | "text_only";
  interpretation: TimedInterpretation;
};
```

`packages/shared/src/interfaces.ts`: the four interfaces from brief section 8, verbatim, plus:

```ts
export interface Queue {
  add(name: "generate_reel", data: { messageId: string }): Promise<void>;
  process(name: "generate_reel", handler: (data: { messageId: string }) => Promise<void>): void;
}
```

---

## 9. Endpoint and webhook contracts

All `/api/*` routes require `Authorization: Bearer <supabase access token>`; the server resolves `userId` and scopes every query by it. Errors: `{ error: { code: string, message: string } }` with 400/401/403/404/409/500.

| Method | Path | Purpose | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/integrations` | Connection state | – | `{ slack: {connected, teamName, userName} \| null, telegram: {connected, chatId} \| null, gmail: {status:"coming_soon"}, instagram: {status:"coming_soon"} }` |
| GET | `/api/integrations/slack/start` | Begin OAuth | – | 302 to Slack authorize with signed `state` (HMAC of userId+nonce+exp, 10 min) |
| GET | `/api/integrations/slack/callback` | OAuth callback | `?code&state` | validates state, exchanges code, upserts `connections`, 302 to `${APP_BASE_URL}/connections?slack=ok` |
| DELETE | `/api/integrations/:id` | Disconnect + delete data | – | `{ ok: true }` (revokes token via `auth.revoke`, deletes connection cascade) |
| GET | `/api/integrations/:id/entities` | Trackable people/channels | `?q=` | `{ people: [{id:"U0..", name, avatar}], channels: [{id:"C0..", name, isPrivate}] }` |
| PUT | `/api/tracked-entities` | Replace tracked set | `{ connectionId, entities: [{entityType, externalEntityId, displayName, enabled}] }` | `{ entities: [...] }` |
| POST | `/api/telegram/pairing-code` | New code | – | `{ code: "K7Q2ZP", expiresAt, botUsername, deepLink: "https://t.me/<bot>?start=K7Q2ZP" }` |
| GET | `/api/messages` | History | `?limit=50&cursor=` | `{ items: [{id, sender, source, preview, urgency, jobStatus, hasVideo, replyStatus, receivedAt}], nextCursor }` |
| GET | `/api/messages/:id` | Detail | – | `{ message, job, artifact: {videoUrl(signed), audioUrl, interpretation, renderMode}, drafts: [...] }` |
| POST | `/api/messages/:id/retry` | Re-enqueue failed job | – | `{ job: {status:"queued", attemptCount} }` (409 if not failed) |
| POST | `/api/replies/:id/approve` | Approve + send | `{ finalText?: string }` | `{ draft: {status:"sent", sentExternalMessageId} }` or `{ draft: {status:"failed", errorDetail} }` |
| POST | `/api/replies/:id/regenerate` | New draft | `{ tone }` | `{ draft: {...} }` |
| PATCH | `/api/preferences` | Update | partial `UserPreferences` | full `UserPreferences` |
| POST | `/api/demo/inject` | **Demo only**: inject fixture as if from Slack | header `x-demo-secret`; body `{ fixture: "professor_deadline", userId }` | `{ messageId, jobId, mock: true }` |
| POST | `/webhooks/slack/events` | Slack Events | Slack payload | `200 {}` within 3 s; `{challenge}` for url_verification |
| POST | `/webhooks/telegram` | Only when `TELEGRAM_MODE=webhook` | Telegram update, header `X-Telegram-Bot-Api-Secret-Token` | `200` |

Example `GET /api/messages/:id` response (trimmed):

```json
{
  "message": { "id": "6f1…", "senderDisplayName": "Professor Chen", "source": "slack", "originalText": "Hi Jack — because Monday…", "receivedAt": "2026-09-13T14:02:11Z" },
  "job": { "status": "complete", "attemptCount": 1, "startedAt": "…", "completedAt": "…" },
  "artifact": {
    "videoUrl": "https://xxxx.supabase.co/storage/v1/object/sign/reels/…?token=…",
    "renderMode": "remotion",
    "durationMs": 28400,
    "interpretation": { "shortTitle": "作业截止日期已更改", "urgency": "high", "actionItems": [ { "text": "将PDF提交到Quercus", "dueText": "Friday at 5:00 PM", "dueAt": "2026-09-18T17:00:00-04:00", "evidenceQuote": "Submit the PDF to Quercus" } ] }
  },
  "drafts": [ { "id": "a2…", "status": "sent", "userInputOriginal": "教授您好…", "draftEnglish": "Hi Professor Chen, …", "tone": "respectful_student" } ]
}
```

Demo injector is honest by construction: injected messages get `connection.provider='mock'` and the history page shows a `MOCK` badge.

---

## 10. Slack scopes/events and Telegram bot behavior (MVP only)

### Slack app configuration

- **Distribution:** single workspace (team-owned). No app directory review needed.
- **OAuth user scopes** (v2, `user_scope` param): `channels:history`, `groups:history`, `im:history`, `mpim:history`, `channels:read`, `groups:read`, `im:read`, `mpim:read`, `users:read`, `chat:write`.
- **Bot scopes:** none required for MVP (fallback mode adds bot `channels:history`, `chat:write`, `users:read`, `channels:read`).
- **Event subscriptions (user events):** `message.im`, `message.channels`, `message.groups`, `message.mpim`.
- **Request URL:** `${API_BASE_URL}/webhooks/slack/events`. ngrok must be running before saving.
- **Redirect URL:** `${SLACK_REDIRECT_URI}`.
- Token stored: `authed_user.access_token` (xoxp), `authed_user.id`, `team.id`.
- Events are delivered for conversations visible to the authorizing user. Filtering by `tracked_entities` is enforced server-side before any persistence; untracked messages are dropped and never stored.
- Replies use `chat.postMessage` with the user token → appears as the student. `thread_ts` = original `thread_ts` if the message was in a thread, otherwise the original `ts` (starts a thread under the professor's message, which is the ideal demo visual).
- **Verification at hour 1 (task 5):** if user-scope events do not arrive within 15 minutes of setup, switch to bot mode: add bot scopes, invite bot to `#demo-class`, track the channel instead of the person.

### Telegram bot behavior

| Trigger | Behavior |
| --- | --- |
| `/start <CODE>` or `/start` then code text | Validate code (unused, unexpired) → insert `connections(provider=telegram, external_account_id=chat_id)` + `telegram_sessions` → "Paired with jle@… ✅. Reels will arrive here." |
| Reel delivered | `sendVideo` with caption `🎬 Professor Chen · Slack · ⚠️ urgent\n<shortTitle>\n<AI-assisted translation>` + keyboard `[📄 Original] [✅ Key actions]` / `[✍️ Reply] [👍 I understood]` |
| `📄 Original` | `answerCallbackQuery` + send original text verbatim in a `<pre>` block with sender + timestamp |
| `✅ Key actions` | Send bullet list: action + due text + evidence quote; then ambiguities as "⚠️ Unclear: …" |
| `✍️ Reply` | Set `awaiting_reply`; prompt "Write your reply in any language. I'll draft it in English (tone: respectful student)." |
| `👍 I understood` | Acknowledge, no DB change needed beyond log |
| Text while `awaiting_reply` | Generate draft → send "You wrote: … / English draft: … / Meaning check: …" + `[📤 Send] [✏️ Edit] [🎭 Tone] [❌ Cancel]` |
| `📤 Send` | approve → Slack send → "Sent to Slack ✅ (thread under Professor Chen's message)" |
| `✏️ Edit` | state `editing_draft`; next text replaces `draft_english`; re-show keyboard |
| `🎭 Tone` | keyboard with four tones; regenerate |
| `❌ Cancel` | draft cancelled; state idle |
| Text while `idle` | "Tap ✍️ Reply under a reel first, or send /help." |
| `/help`, `/status` | Help text; last 3 messages + job status |

Callback data format (≤ 64 bytes): `o:<msgId8>`, `a:<msgId8>`, `r:<msgId8>`, `k:<msgId8>`, `s:<draftId8>`, `e:<draftId8>`, `t:<draftId8>`, `c:<draftId8>`, `tone:<draftId8>:<tone>` where `<id8>` is the first 8 chars of the UUID resolved server-side with a prefix match scoped to the chat's user.

Telegram limits: `sendVideo` ≤ 50 MB via multipart. Target ≤ 20 MB with H.264, CRF 23, 1080x1920 at 30 fps; fallback 720x1280.

---

## 11. LLM prompts

Provider: Anthropic Claude `claude-opus-5`, structured output via `client.messages.parse` with `output_config: { format: zodOutputFormat(Schema) }`, `max_tokens: 4096`, streaming not needed. Fallbacks enabled: `betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"` on `client.beta.messages.parse` so a safety refusal (`stop_reason: "refusal"`) reroutes instead of failing the job. Always guard `parsed_output === null` → retry once with validation errors appended.

### 11.1 Interpretation system prompt (`prompts.ts: INTERPRET_SYSTEM`)

```text
You are ReelRelay's comprehension engine. You convert one incoming message into a structured, faithful interpretation for a university student who reads {{targetLanguageName}} more comfortably than English.

ABSOLUTE RULES
1. Never invent facts. If something is not in the message, it is not in your output.
2. Preserve EXACTLY: names, dates, times, weekdays, monetary amounts, addresses, URLs, course/room/ID codes, quantities, requirements, negations ("do not", "no longer", "unless"), and consequences. Copy them verbatim into preservedFacts and keep them unchanged inside translations.
3. faithfulTranslation = complete translation of the whole message into {{targetLanguageName}}, same paragraph order, nothing dropped, nothing added.
4. spokenSummary = what a careful friend would say aloud in {{targetLanguageName}} in 20–35 seconds (max ~90 words in English-equivalent length): what changed, what to do, by when, and any "do NOT" instruction. Keep proper nouns and platform names (e.g. Quercus, Slack) in their original form.
5. spokenSegments = spokenSummary split into ordered chunks of at most ~12 words / 25 CJK characters each, suitable as on-screen captions. Concatenating them must reproduce spokenSummary.
6. Every actionItem needs evidenceQuote copied verbatim from the ORIGINAL English message (a real substring). dueText is the verbatim time phrase or null. dueAt is ISO 8601 with timezone {{timezone}} ONLY if the date is unambiguous given "today is {{today}}"; otherwise null and add the issue to ambiguities.
7. A negated instruction ("do not upload X") is an actionItem whose text starts with the {{targetLanguageName}} equivalent of "Do NOT".
8. Mark uncertainty explicitly in ambiguities (e.g. "‘Wednesday’ could be this week or next"). Do not resolve ambiguity by guessing.
9. Do not give legal, academic, immigration, housing, financial, medical, or safety advice. Do not tell the student what decision to make. You may suggest clarifying questions.
10. isSensitive = true if the message concerns grades/academic integrity, money owed, housing/eviction, employment status, health, immigration, legal matters, or personal conflict. tone = "sensitive" in those cases.
11. hook = one short attention line in {{targetLanguageName}} stating why this matters (e.g. "重要：作业截止日期已更改").
12. Output only the JSON object matching the schema. No commentary.

Sender: {{senderDisplayName}} ({{senderRole}} if known). Source: {{provider}}. Student's name: {{studentName}}.
```

User message content:

```text
<message>
{{originalText}}
</message>
<thread_context>
{{previousThreadMessages or "none"}}
</thread_context>
```

Retry-on-validation-failure user message (appended as a second turn):

```text
Your previous JSON failed validation:
{{zodIssuesAsText}}
Return the corrected JSON object only. Do not change any facts.
```

### 11.2 Deterministic fact-preservation check (`factCheck.ts`)

Runs after parse; failures trigger the retry turn with the issue text:

- every `actionItems[].evidenceQuote` must be a case-insensitive substring of `originalText` (whitespace-normalized);
- every number, time (`\d{1,2}(:\d{2})?\s?(AM|PM)`), weekday, and URL found in `originalText` must appear in `faithfulTranslation` or `preservedFacts[].value`;
- if `originalText` matches `/\b(do not|don't|never|no longer|must not)\b/i`, at least one `actionItems[].text` or `ambiguities[]` must reference a negation (check for "不要|不得|勿|Do NOT|do not|không|no " in target/English forms; keep the regex list per supported language in `factCheck.ts`).

### 11.3 Reply-draft system prompt (`prompts.ts: REPLY_SYSTEM`)

```text
You draft English replies on behalf of a university student. The student writes in their own language; you produce what they would send if fluent in English.

RULES
1. Translate the student's meaning faithfully. Do not add commitments, apologies, excuses, or information the student did not express. Do not remove anything they said.
2. Tone = {{tone}}:
   - respectful_student: polite, formal greeting and sign-off, addresses the recipient by title if known ("Hi Professor Chen,"), no slang.
   - concise_professional: brief, direct, courteous, workplace register, one greeting line.
   - warm: friendly and appreciative, still clear.
   - direct: shortest faithful version, no pleasantries beyond one greeting.
3. Reference the original message's facts exactly (dates, times, names, platforms). If the student's reply mentions a date/time, keep it exactly as they wrote it, converted to English words only.
4. If the student's input does not address a question the sender asked, add a warning (in {{targetLanguageName}}) in warnings; do NOT answer it for them.
5. meaningCheck = one sentence in {{targetLanguageName}} paraphrasing what the English draft says, so the student can verify before sending.
6. Sign as {{studentName}}. Never mention AI or translation in the draft.
7. Output only the JSON object matching the schema.
```

User content:

```text
<original_message sender="{{senderDisplayName}}">{{originalText}}</original_message>
<interpretation_summary>{{senderIntent}} | actions: {{actionItemsJoined}}</interpretation_summary>
<student_reply_original>{{userInput}}</student_reply_original>
```

Draft display in Telegram always carries the label `AI-assisted draft — review before sending`.

---

## 12. Reel composition specification

Remotion composition `Reel` in `packages/reel/src/ReelComposition.tsx`, 1080x1920, 30 fps, `durationInFrames = ceil(durationMs / 1000 * 30)`.

### Timeline

| Segment | Duration | Content |
| --- | --- | --- |
| 0. Intro | 0–1.2 s | Background fades in; top chip `Professor Chen · Slack`; urgency pill (`⚠️ Urgent` red, `Medium` amber, none for low) |
| 1. Hook | 1.2–3.5 s | `hook` in 72 px bold, centered, slides up; TTS begins at 1.2 s |
| 2. Body | 3.5 s → end of TTS | `captionSegments` shown one at a time, ≤ 2 lines, 64 px, white text with 6 px dark stroke + 60% black rounded backing plate; current word not highlighted (no word timing guarantee) |
| 3. Action card | last TTS + 0.3 s, 4 s | Card: `✅ <action 1 text>` + `📅 <dueText>` (up to 3 actions; the negated action shown with `🚫`); card background solid, no motion behind text |
| 4. Outro | 2 s | `回复请用中文 · 点击下方 ✍️` (localized "Reply in {{language}}") + `AI 辅助翻译` label |

Total = TTS duration + ~7.5 s; if TTS > 37 s the engine's `spokenSummary` is regenerated with a "shorten to under 80 words" instruction once, else the reel is capped at 45 s and the action card still renders (audio fades at cap).

### Caption timing (`tts/timing.ts`)

1. ElevenLabs `POST /v1/text-to-speech/{voice}/with-timestamps` returns `alignment.characters[]`, `character_start_times_seconds[]`, `character_end_times_seconds[]`.
2. Map each `spokenSegments[i]` to its character span in the concatenated spoken text (cumulative offset, ignoring whitespace differences); `startMs = start of first char`, `endMs = end of last char`, then add the 1.2 s hook offset; enforce `endMs - startMs ≥ 700` and no overlap (push the next start).
3. **Fallback (no alignment):** estimate `durationMs = audioDurationMs (ffprobe)`; distribute proportionally to segment weight where weight = CJK chars × 1.0 + Latin words × 1.6; same 700 ms minimum.
4. **Captions-only (no audio):** 2.2 s + 90 ms per CJK char / 60 ms per Latin char per segment; no audio track.

### Backgrounds

- `Playful.tsx`: procedurally animated parallax of rounded shapes and a "runner" dot on a lane, 3 palettes; deterministic via `random(seed)`; low contrast behind the caption plate. No third-party footage.
- `Calm.tsx`: slow radial gradient drift + soft noise; used when `isSensitive || preferences.sensitiveMode && tone === 'sensitive'` or `visualStyle === 'calm'`.
- Optional `assets/loops/pexels-<id>.mp4` (Pexels license) wired via `<OffthreadVideo loop>` only if downloaded and license URL recorded in `assets/loops/LICENSES.md`.

### Fonts

Bundle `NotoSans-Bold.ttf` and `NotoSansSC-Bold.ttf` (SIL OFL) and load via `@remotion/fonts`; `NotoSansSC` covers zh/ja partially; add `NotoSansJP`/`NotoSansKR` only if a demo language needs it. Vietnamese and European languages fall back to `NotoSans`.

### Rendering

`RemotionRenderer.render()`:

```text
bundle once at boot (webpack bundle cached at .remotion-bundle/) → selectComposition('Reel', inputProps) → renderMedia({codec:'h264', crf:23, audioCodec:'aac', outputLocation, timeoutInMilliseconds: RENDER_TIMEOUT_MS, concurrency: 2})
```

`FfmpegRenderer.render()` fallback: `ffmpeg -stream_loop -1 -i calm_loop.mp4 -i voice.mp3 -vf "drawtext=…"` using an ASS subtitle file generated from `captionSegments` (`subtitles=captions.ass`), `-shortest`, 720x1280. Text-only fallback: Telegram message card with hook, spoken summary, and action list (no video).

---

## 13. Numbered implementation tasks

Legend: **P** = can run in parallel with other tasks whose dependencies are satisfied. Times are for one developer.

| # | Task | Depends on | Est. | Parallel |
| --- | --- | --- | --- | --- |
| 1 | Monorepo skeleton | – | 30 m | – |
| 2 | Shared Zod contracts | 1 | 30 m | P |
| 3 | Supabase project, migration, storage bucket, encryption helper | 1 | 40 m | P |
| 4 | Fastify server boot, env validation, auth middleware, `Queue` + memory queue | 1, 2 | 40 m | P |
| 5 | Slack app + OAuth (start/callback) + token storage | 3, 4 | 60 m | P |
| 6 | Slack events webhook: verify, ack, normalize, filter, idempotent persist, enqueue | 2, 4, 5 | 60 m | – |
| 7 | Entities listing (`users.list`, `conversations.list`) + tracked entities API | 5 | 40 m | P |
| 8 | Telegram bot: pairing, session table, `/help`, `/status` | 3, 4 | 45 m | P |
| 9 | Claude engine: interpretation prompt, `messages.parse`, retry, fact check | 2 | 75 m | P |
| 10 | Fixtures + expected facts + engine tests | 9 | 30 m | P |
| 11 | ElevenLabs TTS + timing + fallbacks | 2 | 45 m | P |
| 12 | Remotion composition (template, both backgrounds, fonts, action card) | 2 | 120 m | P |
| 13 | RemotionRenderer + FfmpegRenderer + upload + signed URL | 11, 12 | 60 m | – |
| 14 | Worker `generateReel` pipeline with status transitions + failure modes | 6, 9, 11, 13 | 45 m | – |
| 15 | Telegram delivery: `sendVideo`, buttons, Original/Key actions handlers | 8, 14 | 45 m | – |
| 16 | Reply flow: state machine, draft prompt, Send/Edit/Tone/Cancel, approval gate | 9, 15 | 75 m | – |
| 17 | Slack `sendReply` with threading + `/api/replies/:id/approve` | 5, 16 | 30 m | – |
| 18 | Web: auth pages, app layout, API client | 3 | 45 m | P |
| 19 | Web: Connections page (Slack card, Telegram pairing card, coming-soon cards) | 18, 5, 8 | 40 m | P |
| 20 | Web: Tracking page | 18, 7 | 40 m | P |
| 21 | Web: Preferences page | 18 | 30 m | P |
| 22 | Web: History list + detail with video player, status polling, retry | 18, 14 | 50 m | P |
| 23 | Demo injector (`/api/demo/inject`, `scripts/inject-demo.ts`, MOCK badge) | 6, 14 | 25 m | P |
| 24 | Landing page | 18 | 30 m | P |
| 25 | Tests for risky boundaries (section 14) | 6, 9, 16 | 60 m | P |
| 26 | E2E rehearsal, latency measurement, backup video, pitch | all | 90 m | – |

### Task details

**1. Monorepo skeleton**
- Goal: `pnpm install && pnpm dev` starts web (3000) and server (4000).
- Files: root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.env.example`, `apps/web` (create-next-app, Tailwind, shadcn init), `apps/server` (Fastify + tsx), `packages/shared`, `packages/reel` (Remotion init).
- Acceptance: both apps start; `packages/shared` importable from both via `@reelrelay/shared`.

**2. Shared Zod contracts**
- Files: `packages/shared/src/*.ts` per section 8.
- Acceptance: `MessageInterpretationSchema.parse(fixtures/expected/professor_deadline.interpretation.json)` passes in a test.

**3. Supabase**
- Files: `supabase/migrations/0001_init.sql`, `apps/server/src/db/client.ts` (service role), `apps/server/src/security/crypto.ts` (AES-256-GCM `encrypt/decrypt` with `TOKEN_ENCRYPTION_KEY`).
- Acceptance: migration applied; signup trigger creates `users` + `preferences`; bucket `reels` private; `encrypt(decrypt(x)) === x` test.

**4. Server boot**
- Files: `index.ts`, `config.ts` (zod env), `auth/requireUser.ts` (verify Supabase JWT via `supabase.auth.getUser(token)`), `queue/*`.
- Acceptance: `GET /health` 200; `/api/preferences` returns 401 without token, 200 with; memory queue processes a test job.

**5. Slack OAuth**
- Files: `connectors/slack/oauth.ts`, `routes/api/slack.ts`.
- Inputs: `SLACK_*` env; Outputs: `connections` row with encrypted xoxp token.
- Acceptance: full browser flow lands on `/connections?slack=ok`; invalid/expired `state` → 400; token decrypts and `auth.test` succeeds.

**6. Slack events webhook**
- Files: `routes/webhooks/slack.ts` (raw body parser for this route only), `connectors/slack/verify.ts`, `normalize.ts`, `db/queries/messages.ts`.
- Acceptance: fixture with bad signature → 401; stale timestamp → 401; `url_verification` echoes challenge; same event posted twice → one `messages` row and one job; message from untracked user → no row; response time < 500 ms (processing deferred).

**7. Entities + tracking**
- Files: `routes/api/entities.ts`, `SlackConnector.listTrackableEntities` (`users.list` excluding bots/deleted, `conversations.list types=public_channel,private_channel` where `is_member`).
- Acceptance: response lists the demo professor; `PUT /api/tracked-entities` replaces set; unique constraint prevents duplicates.

**8. Telegram bot**
- Files: `delivery/telegram/bot.ts`, `session.ts`, `routes/api/telegram.ts` (pairing code).
- Acceptance: pairing code created from web → `/start CODE` in Telegram pairs → `connections(provider=telegram)` exists; second use of code rejected; `/status` works.

**9. Claude engine**
- Files: `engine/ClaudeEngine.ts`, `prompts.ts`, `factCheck.ts`.
- Acceptance: for `professor_deadline` fixture with `zh-CN`: 4 action items including a "不要/Do NOT" item for the archive; dueText contains "Friday at 5:00 PM" and "Wednesday"; every evidenceQuote is a substring; ambiguities non-empty for `ambiguous_date`; validation retry path exercised by a test that injects a bad first response.

**10. Fixtures**
- Files: `fixtures/slack/*.json` (full Slack event envelopes), `fixtures/expected/*.json` (`mustContain: [...]` strings).
- Acceptance: a Vitest suite runs the engine against all six fixtures (skipped without `ANTHROPIC_API_KEY`) and asserts `mustContain` in `faithfulTranslation ∪ preservedFacts`.

**11. TTS + timing**
- Files: `tts/elevenlabs.ts`, `tts/timing.ts`.
- Acceptance: returns `{ audioPath, durationMs, captionSegments }`; alignment mapping test with a synthetic alignment; fallback path produces non-overlapping segments summing to duration; with `ELEVENLABS_API_KEY` unset returns `captions_only`.

**12. Remotion composition**
- Files: `packages/reel/src/*`.
- Acceptance: `npx remotion preview` shows the demo interpretation; both backgrounds selectable via props; captions ≤ 2 lines at 1080 width with CJK; action card renders 3 items; `remotion render Reel out.mp4` succeeds with sample props in < 90 s on a laptop.

**13. Renderers + upload**
- Files: `render/RemotionRenderer.ts`, `FfmpegRenderer.ts`, `upload.ts`.
- Acceptance: Remotion path yields ≤ 20 MB MP4 with audio; forcing a Remotion error triggers FFmpeg path; `upload` returns storage path and signed URL works in browser.

**14. Worker pipeline**
- Files: `worker/generateReel.ts`.
- Acceptance: status transitions visible in DB in order; each failure mode from section 15 produces the documented outcome; `attempt_count` increments on retry; a second job for the same message is impossible (unique index).

**15. Telegram delivery**
- Files: `delivery/telegram/TelegramDelivery.ts`, `keyboards.ts`.
- Acceptance: video plays inline in Telegram; `Original` shows exact text; `Key actions` shows due text and evidence; buttons work after bot restart (callback data resolves from DB, not memory).

**16. Reply flow**
- Files: `delivery/telegram/reply.ts`, `engine/ClaudeEngine.draftReply`.
- Acceptance: text while idle is rejected; draft shows original + English + meaning check; `Edit` replaces text; `Tone` regenerates; `Cancel` marks cancelled; **no code path calls `sendReply` except the approve handler** (test asserts `SlackConnector.sendReply` not called before approve).

**17. Slack reply**
- Files: `SlackConnector.sendReply`, `routes/api/replies.ts`.
- Acceptance: message appears in the correct channel as a thread reply under the original; `sent_external_message_id` = returned `ts`; failure → `status=failed` with retry allowed.

**18–22. Web pages**
- Acceptance per page: Connections shows real state; Tracking toggles persist; Preferences persist and change the next reel's language; History polls every 3 s while a job is non-terminal, plays video via signed URL, retry button works on failed jobs; MOCK badge for injected messages.

**23. Demo injector**
- Acceptance: `pnpm demo:inject professor_deadline` produces a Telegram reel end-to-end without Slack; UI labels it MOCK; route rejects missing/incorrect `x-demo-secret`.

**24. Landing**
- Acceptance: one sentence, three-step visual (message → reel → reply), `Get started` → login.

**25. Tests** — see section 14.

**26. Rehearsal** — see section 18.

---

## 14. Testing checklist

### Unit (Vitest, no network)
- [ ] `verify.test.ts`: valid signature passes; tampered body fails; timestamp > 5 min fails; missing headers fail.
- [ ] `oauthState.test.ts`: state round-trips; expired state rejected; wrong HMAC rejected.
- [ ] `filter.test.ts`: tracked person passes; tracked channel passes; untracked dropped; bot messages dropped; `message_changed` dropped; disabled entity dropped.
- [ ] `normalize.test.ts`: DM, channel, and threaded fixtures map to `NormalizedMessage`; `external_message_id = channel:ts`; `external_thread_id` set only when `thread_ts` present.
- [ ] `schema.test.ts`: interpretation fixture parses; missing `evidenceQuote` fails; caption text > 90 chars fails.
- [ ] `factCheck.test.ts`: dropped "5:00 PM" flagged; negation dropped flagged; evidence not substring flagged.
- [ ] `timing.test.ts`: alignment mapping; proportional fallback; captions-only durations; no overlaps.
- [ ] `crypto.test.ts`: encrypt/decrypt round-trip; tampered ciphertext throws.
- [ ] `approval.test.ts`: `sendReply` mock never called from draft/edit/regenerate handlers; called exactly once from approve; approve on a `cancelled` draft → 409.
- [ ] `authz.test.ts`: `GET /api/messages/:id` for another user's message → 404.

### Integration (needs keys; skip without)
- [ ] Engine on all six fixtures satisfies `mustContain` and negation rule.
- [ ] TTS returns audio with alignment for a zh-CN string and a vi string.
- [ ] Remotion renders sample props to MP4 < 90 s, ≤ 20 MB.
- [ ] Idempotency: posting the same Slack event twice yields one job (DB assertion).
- [ ] Retry: failed job → `/retry` → `queued` → `complete`.

### End-to-end (manual, timed)
- [ ] Definition-of-done steps 1–12 from the brief, executed twice, with latency logged by `scripts/smoke-e2e.ts` (message received → `complete`).
- [ ] Same flow via demo injector.
- [ ] Bot restart mid-flow: buttons on an old reel still work.

---

## 15. Failure/retry behavior and demo fallbacks

| Failure | Detection | Behavior | User sees |
| --- | --- | --- | --- |
| Duplicate Slack event (retry header `X-Slack-Retry-Num`) | `ON CONFLICT DO NOTHING` returns 0 rows | 200, no job | nothing |
| Slack retry before first ack processed | same | same | nothing |
| LLM parse failure / fact check failure | `parsed_output === null` or factCheck issues | one retry turn with issues; then `failed(error_code=LLM_INVALID)` | History: "Failed – retry"; Telegram: text card with original + "translation unavailable" |
| LLM refusal | `stop_reason === 'refusal'` | server-side fallback model; if still refused → `failed(LLM_REFUSED)` | same as above |
| TTS error / no key | thrown or missing key | `render_mode=captions_only`, no audio | silent reel with captions |
| TTS too long (> 37 s) | `durationMs` | re-summarize once shorter; then cap at 45 s | slightly cut audio, action card intact |
| Remotion error/timeout (120 s) | thrown | `FfmpegRenderer`; on failure `text_only` | Telegram structured text card immediately; video later if retry succeeds |
| Video > 50 MB | size check | re-render 720p CRF 28; else send signed link | link instead of inline video |
| Telegram send failure | API error | retry 3× exponential (1, 3, 9 s); then `failed(DELIVERY)` | History shows failed + retry |
| Slack reply failure | API error | draft `status=failed`, `error_detail`; Telegram offers `Retry send` | "Couldn't send — tap to retry" |
| Token revoked | `invalid_auth` | `connections.status=error`; Connections page shows "Reconnect" | reconnect prompt |
| ngrok/OAuth/events broken during judging | manual | **Demo injector** (`pnpm demo:inject professor_deadline`) labeled MOCK, Telegram delivery still real | reel arrives; judge told it is injected |
| Everything broken | manual | play `demo/backup.mp4` recorded at task 26 | pre-recorded run |

Retry policy: `POST /api/messages/:id/retry` allowed when `status='failed'` and `attempt_count < 3`; retry resumes from the earliest failed stage using stored `interpretation_json` and `audio_path` when present.

---

## 16. Security and privacy checklist

- [ ] Slack tokens encrypted at rest (AES-256-GCM, key from env, never logged).
- [ ] Only user-selected senders/channels persisted; everything else dropped before storage.
- [ ] Slack signature + timestamp verified on raw body before JSON parse.
- [ ] OAuth `state` signed and time-limited; redirect URI fixed from env.
- [ ] Telegram webhook secret header verified when in webhook mode; polling mode needs no public route.
- [ ] Demo injector protected by `x-demo-secret` and disabled when `NODE_ENV=production` without the secret set.
- [ ] Every API query filtered by `user_id`; cross-user access returns 404 (tested).
- [ ] Storage bucket private; signed URLs 1 h; Telegram receives file bytes, not URLs.
- [ ] Logs redact tokens and truncate message bodies to 80 chars.
- [ ] Disconnect endpoint revokes Slack token and cascades deletion of messages, artifacts, drafts.
- [ ] Retention: cron-style job on boot deletes artifacts and messages older than 7 days (configurable).
- [ ] No auto-send: only `approve` calls `sendReply` (test-enforced).
- [ ] "AI-assisted" label on every reel caption and every draft.
- [ ] Web copy states that message text is processed by Anthropic and ElevenLabs; no end-to-end encryption claim.
- [ ] Minimal Slack scopes listed in section 10; no `admin` or `users:read.email`.

---

## 17. 12-hour team allocation

### 2 developers
| | Dev A (backend/pipeline) | Dev B (integrations/UI) |
| --- | --- | --- |
| 0–1 | 1, 2, 4 | 3, Slack app + Telegram bot creation, ngrok |
| 1–3 | 9, 10 | 5, 6, 8 |
| 3–5 | 11, 12 (template first) | 7, 18, 19, 20 |
| 5–7 | 13, 14 | 15, 21, 22 |
| 7–9 | 16, 17 | 23, 24, 25 (unit tests) |
| 9–10.5 | polish reel, latency | history polish |
| 10.5–12 | 26 together | 26 together |

Cut if behind: 24 (landing → static text), 21 (preferences via seed row), FFmpeg fallback.

### 3 developers (baseline)
| | Dev A (pipeline) | Dev B (connectors) | Dev C (reel + web) |
| --- | --- | --- | --- |
| 0–1 | 1, 2, 4 | 3, Slack/Telegram app setup, ngrok | Remotion init, fonts, background prototypes |
| 1–3 | 9, 10 | 5, 6, 7 | 12 |
| 3–5 | 11, 14 (skeleton) | 8, 15 | 12 (finish), 13 |
| 5–7 | 14 (complete), 23 | 16, 17 | 18, 19, 20 |
| 7–9 | 25 | 25 (connector tests) | 21, 22, 24 |
| 9–10.5 | latency + fallbacks | reply polish | UI polish |
| 10.5–12 | 26 | 26 | 26 |

### 4 developers
Dev D takes all web tasks (18–22, 24) from hour 1; Dev C focuses on 12, 13 and reel quality (word-level caption highlight, second palette, Pexels loop). Dev A adds urgency chip + deadline reminder (stretch 2) only after task 14 is complete.

---

## 18. Final rehearsal checklist and 90-second pitch

### Rehearsal checklist (hour 10.5+)
- [ ] ngrok running with the URL saved in Slack app settings; `GET /health` reachable publicly.
- [ ] Slack: demo student account connected; `Professor Chen` tracked; test DM produced a reel in the last 30 min.
- [ ] Telegram: paired; bot polling; old buttons still work.
- [ ] Preferences: `zh-CN`, playful, respectful_student.
- [ ] Demo message text saved in the professor account's clipboard manager.
- [ ] `pnpm demo:inject professor_deadline` tested as fallback.
- [ ] Backup video `demo/backup.mp4` recorded from a full successful run (screen + phone).
- [ ] Latency measured on 3 runs; number written on a sticky note for the pitch.
- [ ] Fact preservation results on 6 fixtures written down.
- [ ] Laptop: notifications off, Slack + Telegram Desktop + History page arranged; phone with Telegram as second screen.
- [ ] Challenge 2 criteria rows added (see section 2 blocker).

### 90-second pitch outline
1. **(0–15 s) Problem:** An international student gets a dense English Slack message from a professor with a moved deadline and a "do NOT" instruction. Wrong format, language, and moment; it gets skimmed and missed.
2. **(15–30 s) Live send:** Professor sends the message. History page shows `Analyzing → Voicing → Rendering → Delivered`.
3. **(30–55 s) Reel:** Play the Mandarin reel on the phone. Tap `Key actions`: Friday 5 PM, Wednesday, PDF to Quercus, do NOT upload the archive. Tap `Original`.
4. **(55–75 s) Reply:** Type Mandarin clarification. Show English draft in respectful tone with meaning check. Tap `Send`. Show the threaded reply in Slack under the professor's message.
5. **(75–90 s) Close:** "The sender did not change how they communicate. ReelRelay changed the format, place, language, tone, and timing for the recipient. Nothing was sent without approval, and the original was never hidden." State latency and fact-preservation numbers.

---

## 19. Post-hackathon extensions (not MVP)

1. Gmail connector (OAuth, Pub/Sub push, reply via Gmail API) behind `SourceConnector`.
2. Urgency-based reminders (Telegram nudge 24 h before `dueAt`).
3. One-question comprehension check after `urgency=high`.
4. AI-generated context backgrounds rendered asynchronously and cached per topic.
5. Instagram professional-account messaging adapter (Meta app review required).
6. Discord/WhatsApp delivery adapters.
7. Automatic visual mode selection (playful/calm/timeline) from tone and action count.
8. Word-level caption highlighting from alignment data.
9. BullMQ + separate worker container; Vercel web + Fly.io server.
10. Per-sender tone defaults and roommate/club "casual" tone.

---

## 20. Chronological execution checklist

Execute top to bottom. Owner initials per section 17.

**Hour 0–1**
- [ ] Create Supabase project; note URL/keys. (B)
- [ ] Create Slack app (single workspace), set user scopes + events + redirect from section 10; do not save events URL until ngrok is up. (B)
- [ ] Create Telegram bot via @BotFather; note token and username. (B)
- [ ] Start ngrok; reserve domain if possible; fill `.env`. (B)
- [ ] Task 1 monorepo; task 2 contracts; task 4 server boot. (A)
- [ ] Task 3 migration + crypto. (B)
- [ ] Remotion init, fonts, background prototypes running in preview. (C)

**Hour 1–3**
- [ ] Task 5 Slack OAuth; verify `auth.test`. (B)
- [ ] Task 6 events webhook; confirm a real DM produces a `messages` row. **Decision point: user-scope events working? If not, switch to bot mode.** (B)
- [ ] Task 9 engine + task 10 fixtures; run engine on professor fixture, inspect output by hand. (A)
- [ ] Task 12 composition with static sample props. (C)

**Hour 3–5**
- [ ] Task 7 entities API. (B)
- [ ] Task 8 Telegram pairing. (B)
- [ ] Task 11 TTS + timing; produce first real Mandarin mp3. (A)
- [ ] Task 13 renderers + upload; first full MP4 from real interpretation. (C)
- [ ] Task 14 worker skeleton wired to memory queue. (A)

**Hour 5–7**
- [ ] Task 14 complete with all status transitions. (A)
- [ ] Task 15 Telegram delivery; first reel arrives on a phone. **Milestone: Slack → Telegram reel works.** (B)
- [ ] Task 23 demo injector. (A)
- [ ] Tasks 18, 19, 20 web. (C)

**Hour 7–9**
- [ ] Task 16 reply flow; task 17 Slack threaded reply. **Milestone: definition-of-done steps 1–12 pass once.** (B)
- [ ] Task 25 tests on verify/filter/idempotency/approval/authz. (A)
- [ ] Tasks 21, 22, 24 web. (C)

**Hour 9–10.5**
- [ ] Run `scripts/smoke-e2e.ts` three times; log latency. (A)
- [ ] Force each failure mode once (kill TTS key, force Remotion error, duplicate event) and confirm fallbacks. (A)
- [ ] Reply polish: meaning check wording, tone picker. (B)
- [ ] History page polling, MOCK badge, video playback on mobile width. (C)

**Hour 10.5–12**
- [ ] Record `demo/backup.mp4` from a clean run. (C)
- [ ] Full rehearsal twice using section 18 checklist. (all)
- [ ] Add Challenge 2 criteria rows if received. (A)
- [ ] Freeze code; only critical-path fixes after this point. (all)
- [ ] Pitch run-through with timer. (all)
