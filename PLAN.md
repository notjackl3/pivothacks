# ReelRelay — Implementation Plan (12-hour hackathon, 3 developers)

This document is self-contained. It replaces the original build brief for the hackathon; nothing here requires reading another document. Where a fact was verified against official documentation it is marked **[verified]**; where it was not, it is marked **[unverified]** and carries a fallback.

**Per-developer work split:** `PLAN-DEV-A.md` (pipeline + reel) and `PLAN-DEV-B.md` (connectors + web) assign every task here to one owner with disjoint file ownership. This file remains the single source of contracts; the split files never restate them.

**Core product (never cut):** a student receives a Slack message from one tracked sender → gets a translated, captioned vertical video in Telegram → can open the exact original and the full action list → writes a reply in their own language → reviews an English draft → explicitly approves → the reply is posted into the original Slack thread. Nothing is ever sent without the approve tap.

---

## 1. Executive summary and final MVP boundary

### Required MVP (hour 0–9)

| Area | MVP | Stretch (only after section 20 milestone M4) |
| --- | --- | --- |
| Sign-in | Supabase Auth magic link | – |
| Source | Real Slack OAuth (user token) + Events API, **one tracked DM sender** | Track channels, multiple senders |
| Delivery | Telegram bot, pairing by one-time code | QR pairing |
| Language | **One demo language: Simplified Chinese (`zh-CN`)**, selectable field in DB but only `zh-CN` tested | Vietnamese, Korean, others |
| Comprehension | Claude structured interpretation with deterministic faithfulness checks | Urgency reminders, comprehension quiz |
| Voice | ElevenLabs TTS with character timestamps; captions-only fallback | Voice choice, speed control |
| Video | **One calm Remotion template**, 720x1280 | Playful background, 1080p, FFmpeg fallback renderer |
| Telegram buttons | `Original`, `Actions`, `Reply`, `Got it` | `I understood` analytics |
| Reply | Draft in `respectful_student` tone, `Send` / `Cancel` / `Regenerate` | `Edit` in place, tone picker |
| Web | Setup page (Slack connect, Telegram pair, pick sender, pick language) + History page (status, video, original, actions, drafts, retry) | Landing polish, preferences page, disconnect UI |
| Demo | Injector for the professor fixture (labeled MOCK) + prerecorded backup | – |

### Key assumptions

1. One Node process (Fastify API + Slack webhook + Telegram polling + in-process worker) runs on a laptop behind ngrok during judging. In-memory queue behind a `Queue` interface.
2. Slack is authorized with a **user token** so the student's own DMs are visible and replies post **as the student**. **[verified]** The bot-token fallback posts as the bot (section 10).
3. The demo professor is a second Slack account in a team-owned workspace; the demo student is a third account paired to a phone with Telegram.
4. Reel target 25–40 s; no hard audio cut (section 12 policy). MP4 ≤ 20 MB.
5. Team of 3 (A: pipeline, B: connectors, C: reel + web). Section 17 gives 2- and 4-person variants.

---

## 2. Challenge-alignment matrix

### Challenge 1 — Communication Breakdown

> Important information is often misunderstood, ignored, or missed because it is communicated in the wrong format, place, tone, or moment.

| Breakdown | Addressed by | Demo proof |
| --- | --- | --- |
| Wrong format | Dense text → narrated, captioned vertical video | Play the reel |
| Wrong place | Delivered to Telegram, the channel the student chose | Reel arrives on the phone |
| Wrong tone | `senderIntent` shown; reply drafted in a respectful student tone | Show draft |
| Wrong moment | `urgency` chip and pinned deadline on action card | "Friday 5:00 PM" card |
| Language barrier | `faithfulTranslation` + narrated summary in `zh-CN` | Mandarin narration |
| Information loss | `Original` button shows exact text; `Actions` shows every action with evidence quote | Tap both; show "do NOT upload the archive" |

### Challenge 2 — University student living independently

> Your primary user is now a university student living independently for the first time. They are suddenly communicating with professors, employers, landlords, roommates, clubs, services, and unfamiliar institutions. Adapt your solution around that reality.

| Student reality | Response |
| --- | --- |
| Power-imbalanced counterparties | Respectful student tone by default; sender title used in draft |
| High-stakes institutional messages | `isSensitive` forces the calm template (the only MVP template anyway); no advice, only clarifying questions |
| First time managing deadlines | Every action carries `dueText` verbatim and `evidenceQuote` |
| Fear of replying wrongly | Draft shows the student's original + English + a one-line meaning check in Chinese; nothing sends without approval |

> **BLOCKER — judging criteria for Challenge 2 are UNKNOWN.** The statement above is verbatim; no criteria have been invented. When they arrive, add one row per criterion here before rehearsal (task 24).

---

## 3. Final stack choices

| Layer | Choice | Responsibility | Account / key | Risk |
| --- | --- | --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo, TS 5, Node 20 | one `pnpm dev` | – | – |
| Web | Next.js 15 App Router + Tailwind | Setup + History pages | Vercel optional | – |
| Server | Fastify 5 (`apps/server`) | API, Slack webhook, Telegram bot, worker | – | – |
| Auth/DB/Storage | Supabase (Auth, Postgres, private bucket `reels`) | users, tables, artifacts | Supabase free tier | – |
| Queue | in-memory `Queue`; BullMQ optional | async reel jobs | – | – |
| Slack | `@slack/web-api` + hand-written events route | OAuth, events, `chat.postMessage` | Slack app in team workspace | **Admin approval** on managed workspaces; use team-owned workspace |
| Telegram | Telegraf 4, long polling | delivery, buttons, replies | @BotFather token | – |
| LLM | Anthropic `claude-opus-5` via `@anthropic-ai/sdk` `messages.parse` + `zodOutputFormat`; interpretation `effort: "medium"`, reply `effort: "low"` | structured JSON | `ANTHROPIC_API_KEY` | **Paid** |
| TTS | ElevenLabs `eleven_multilingual_v2`, `/with-timestamps` **[verified endpoint + alignment shape]** | audio + caption timing | ElevenLabs key | **Paid** past free tier |
| Video | Remotion 4 `@remotion/renderer` (`bundle → selectComposition → renderMedia`) **[verified]** | MP4 with burned captions | – | **License [unverified]:** believed free for individuals/teams ≤ 3; confirm at remotion.dev/docs/license before submission |
| Tunnel | ngrok with a reserved domain | stable Slack URLs | ngrok account | free tier URL rotates on restart without reservation |
| Tests | Vitest | unit + integration | – | – |

---

## 4. Architecture, interfaces, and sequences

### 4.1 Components

```text
apps/web (Next.js) ──bearer REST──▶ apps/server (Fastify, one process)
                                     ├─ routes/api/*            session-auth REST
                                     ├─ routes/webhooks/slack   verify → ack → filter → persist → enqueue
                                     ├─ telegram/bot            Telegraf long polling
                                     ├─ queue/                  in-memory (BullMQ optional)
                                     └─ worker/generateReel     analyze → tts → render → deliver
                                          │            │              │
                                     Supabase PG   Supabase Storage   Anthropic / ElevenLabs
```

### 4.2 Core interfaces (`packages/shared/src/interfaces.ts`)

```ts
export interface SourceConnector {
  connect(userId: string): Promise<{ authorizeUrl: string }>;
  listTrackableEntities(connectionId: string): Promise<TrackableEntity[]>;
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;
  normalizeEvent(payload: unknown): NormalizedMessage | null;
  sendReply(message: NormalizedMessage, text: string): Promise<{ externalMessageId: string }>;
}

export interface DeliveryConnector {
  pair(userId: string, pairingCode: string): Promise<void>;
  sendReel(deliveryTargetId: string, artifact: ReelArtifact): Promise<string>;   // returns delivery message id
  sendDraft(deliveryTargetId: string, draft: ReplyDraft): Promise<string>;
}

export interface ComprehensionEngine {
  analyze(message: NormalizedMessage, prefs: UserPreferences): Promise<MessageInterpretation>;
  draftReply(ctx: ConversationContext, userInput: string, tone: ReplyTone): Promise<ReplyDraftOutput>;
}

export interface ReelRenderer {
  render(interp: TimedInterpretation, prefs: UserPreferences): Promise<ReelArtifact>;
}

export interface Queue {
  add(name: "generate_reel", data: { messageId: string }): Promise<void>;
  process(name: "generate_reel", handler: (d: { messageId: string }) => Promise<void>): void;
}
```

Implementations: `SlackConnector`, `MockSourceConnector` (demo injector), `TelegramDelivery`, `ClaudeEngine`, `RemotionRenderer`.

### 4.3 Sequence: incoming Slack message

```text
POST /webhooks/slack/events (raw body)
 1. verify: |now - X-Slack-Request-Timestamp| ≤ 300 s; HMAC-SHA256(signingSecret, "v0:" + ts + ":" + rawBody) === X-Slack-Signature (timing-safe)  [verified]
 2. type=url_verification → 200 {challenge}
 3. reply 200 {} immediately; continue in setImmediate                                 [verified: 3 s limit]
 4. drop if event.bot_id, event.subtype present (message_changed, message_deleted, …), or channel_type != 'im' (MVP)
 5. connection = connections WHERE provider='slack' AND external_account_id=team_id AND external_user_id=authorizations[0].user_id
 6. tracked = tracked_entities WHERE connection_id AND entity_type='person' AND external_entity_id=event.user AND enabled
 7. INSERT messages … ON CONFLICT (connection_id, external_message_id) DO NOTHING; external_message_id = `${channel}:${ts}`; 0 rows → stop (Slack retry or duplicate)
 8. INSERT processing_jobs(status='queued'); queue.add('generate_reel', {messageId})
```

### 4.4 Sequence: reel generation

```text
analyzing  → ClaudeEngine.analyze → zod parse → faithfulness checks (§11.2) → on failure one retry turn with the issues → store interpretation_json
voicing    → ElevenLabs with-timestamps on spokenText → mp3 + alignment → captionSegments (§12)
             failure → render_mode='captions_only' (estimated timing, silent)
rendering  → RemotionRenderer (timeout 150 s) → failure → render_mode='text_only'
delivering → upload to Storage → Telegram sendVideo (bytes) + keyboard; text_only → sendMessage card
complete   → reel_artifacts.delivery_message_id
failure    → processing_jobs.status='failed', error_code; retry from the failed stage via POST /api/messages/:id/retry
```

### 4.5 Sequence: reply and approval

```text
[Reply] tap → ownership check (§10) → telegram_sessions.state='awaiting_reply', active_message_id
text → ClaudeEngine.draftReply → reply_drafts(status='draft') → bot shows original + English + meaning check + [Send][Regenerate][Cancel]
[Send] → UPDATE reply_drafts SET status='approved', approved_at=now() WHERE id=$1 AND status='draft' RETURNING id
         0 rows → answerCallbackQuery("Already handled") and stop   ← duplicate-tap guard
         1 row  → SlackConnector.sendReply(thread_ts = parent ts) → status='sent', sent_external_message_id
                  network error / timeout after the request left → status='send_uncertain' → reconcile (§15)
```

---

## 5. Repository directory tree

```text
reelrelay/
├─ package.json  pnpm-workspace.yaml  turbo.json  .nvmrc  .env.example  PLAN.md  README.md  CLAUDE.md
├─ apps/
│  ├─ web/
│  │  ├─ app/{page.tsx, login/page.tsx, setup/page.tsx, history/page.tsx, history/[id]/page.tsx, auth/callback/route.ts}
│  │  ├─ components/{SlackCard,TelegramCard,SenderPicker,LanguagePicker,JobStatus,ReelPlayer,DraftList}.tsx
│  │  └─ lib/{api.ts, supabase/client.ts, supabase/server.ts}
│  └─ server/
│     ├─ src/index.ts  config.ts
│     ├─ src/auth/requireUser.ts            # bearer → userId
│     ├─ src/db/{client.ts, queries/*.ts}
│     ├─ src/security/{crypto.ts, oauthState.ts}
│     ├─ src/routes/api/{integrations,slack,entities,telegram,messages,replies,preferences,demo}.ts
│     ├─ src/routes/webhooks/slack.ts
│     ├─ src/connectors/slack/{SlackConnector,verify,normalize,oauth}.ts
│     ├─ src/connectors/mock/MockSourceConnector.ts
│     ├─ src/delivery/telegram/{bot,TelegramDelivery,keyboards,session,reply}.ts
│     ├─ src/engine/{ClaudeEngine,prompts,faithfulness}.ts
│     ├─ src/tts/{elevenlabs,timing}.ts
│     ├─ src/render/{RemotionRenderer,upload}.ts
│     ├─ src/queue/{Queue,memoryQueue}.ts
│     ├─ src/worker/generateReel.ts
│     └─ test/*.test.ts
├─ packages/
│  ├─ shared/src/{index,interpretation,messages,preferences,api,interfaces}.ts
│  └─ reel/src/{Root,ReelComposition,CalmBackground,Captions,ActionCard,Chip}.tsx + public/fonts/{NotoSans-Bold,NotoSansSC-Bold}.ttf
├─ supabase/migrations/0001_init.sql
├─ fixtures/slack/{professor_deadline,landlord_docs,manager_steps,ambiguous_date,bilingual,negation}.json
├─ fixtures/expected/*.json
├─ demo/backup.mp4                           # recorded in task 22, labeled PRERECORDED
└─ scripts/{inject-demo.ts, smoke-e2e.ts}
```

---

## 6. Environment variable template (`.env.example`, placeholders only)

```bash
NODE_ENV=development
PORT=4000
APP_BASE_URL=http://localhost:3000
API_BASE_URL=https://your-name.ngrok.app
NEXT_PUBLIC_API_BASE_URL=https://your-name.ngrok.app

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=placeholder
SUPABASE_SERVICE_ROLE_KEY=placeholder            # server only
SUPABASE_STORAGE_BUCKET=reels
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder

SLACK_CLIENT_ID=0000000000.0000000000
SLACK_CLIENT_SECRET=placeholder
SLACK_SIGNING_SECRET=placeholder
SLACK_REDIRECT_URI=https://your-name.ngrok.app/api/integrations/slack/callback
SLACK_USER_SCOPES=im:history,im:read,users:read,chat:write

TELEGRAM_BOT_TOKEN=000000:placeholder
TELEGRAM_BOT_USERNAME=reelrelay_demo_bot

ANTHROPIC_API_KEY=sk-ant-placeholder
ANTHROPIC_MODEL=claude-opus-5
ELEVENLABS_API_KEY=placeholder
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_VOICE_ID=placeholder

TOKEN_ENCRYPTION_KEY=base64-32-bytes-placeholder   # AES-256-GCM
OAUTH_STATE_SECRET=placeholder-random-32
DEMO_INJECT_SECRET=placeholder-random-32
RENDER_TIMEOUT_MS=150000
REEL_WIDTH=720
REEL_HEIGHT=1280
```

---

## 7. Database schema (`supabase/migrations/0001_init.sql`)

The web app never queries Postgres directly. All reads and writes go through the Fastify API using the service-role key, which is why RLS is enabled on every table with no policies (anon and authenticated roles get nothing).

```sql
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
```

Storage: private bucket `reels`, path `{userId}/{messageId}.mp4`; web gets 1-hour signed URLs; Telegram gets the bytes.

---

## 8. Shared types and Zod contracts (`packages/shared`)

```ts
import { z } from "zod";

export const ReplyToneSchema = z.enum(["respectful_student", "concise_professional", "warm", "direct"]);

export const ActionItemSchema = z.object({
  text: z.string().min(1).max(120),          // in target language
  textEnglish: z.string().min(1).max(120),   // English restatement, used by deterministic checks
  isNegation: z.boolean(),                   // "do NOT …"
  essential: z.boolean(),                    // deadline, changed date, requirement, or negation → must be narrated
  dueText: z.string().nullable(),            // verbatim time phrase from original, e.g. "Friday at 5:00 PM"
  dueAt: z.string().nullable(),              // ISO 8601 only when unambiguous, else null
  evidenceQuote: z.string().min(1),          // verbatim substring of original
});

export const MessageInterpretationSchema = z.object({
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  faithfulTranslation: z.string().min(1),
  hook: z.string().min(1).max(60),                       // shown silently on the hook card, NOT spoken
  spokenSegments: z.array(z.string().min(1).max(60)).min(2).max(30),  // narration = captions, in order
  shortTitle: z.string().min(1).max(60),
  senderIntent: z.string().min(1).max(300),
  urgency: z.enum(["low", "medium", "high"]),
  isSensitive: z.boolean(),
  actionItems: z.array(ActionItemSchema).min(0).max(10),
  preservedFacts: z.array(z.object({ label: z.string(), value: z.string() })).max(20),
  ambiguities: z.array(z.string()).max(6),
  suggestedClarifyingQuestions: z.array(z.string()).max(4),
});
export type MessageInterpretation = z.infer<typeof MessageInterpretationSchema>;

export const CaptionSegmentSchema = z.object({ text: z.string(), startMs: z.number().int(), endMs: z.number().int() });
export const TimedInterpretationSchema = MessageInterpretationSchema.extend({
  captionSegments: z.array(CaptionSegmentSchema).min(1),
  narrationMs: z.number().int().positive(),
  totalMs: z.number().int().positive(),
});
export type TimedInterpretation = z.infer<typeof TimedInterpretationSchema>;

export const ReplyDraftOutputSchema = z.object({
  detectedInputLanguage: z.string(),
  draftEnglish: z.string().min(1).max(1500),
  meaningCheck: z.string().max(300),        // one sentence in target language
  warnings: z.array(z.string()).max(3),
});

export const NormalizedMessageSchema = z.object({
  provider: z.enum(["slack", "mock"]),
  connectionId: z.string().uuid(),
  externalMessageId: z.string(),
  externalChannelId: z.string(),
  externalThreadId: z.string().nullable(),
  senderExternalId: z.string(),
  senderDisplayName: z.string(),
  text: z.string().min(1),
  receivedAt: z.string().datetime(),
});

export const UserPreferencesSchema = z.object({
  targetLanguage: z.string().default("zh-CN"),
  timezone: z.string().default("America/Toronto"),
  replyTone: ReplyToneSchema.default("respectful_student"),
});

export const JobStatusSchema = z.enum(["queued","analyzing","voicing","rendering","delivering","complete","failed"]);
```

---

## 9. Endpoint and webhook contracts

All `/api/*` routes require `Authorization: Bearer <Supabase access token>` except the two marked **no bearer**. Every query is scoped by the resolved `userId`; another user's resource returns 404. Errors: `{ error: { code, message } }`.

| Method | Path | Purpose | Request → Response |
| --- | --- | --- | --- |
| GET | `/api/integrations` | state | → `{ slack: {connected, teamName, userName, mode} \| null, telegram: {connected} \| null }` |
| GET | `/api/integrations/slack/start` | begin OAuth | → `{ url }`; `url` is Slack authorize with `state = base64url(userId.nonce.exp).hmac`. The browser then navigates to `url` (web cannot send a bearer on a redirect, so identity travels in the signed state). |
| GET | `/api/integrations/slack/callback` **no bearer** | OAuth callback | `?code&state` → verify HMAC + `exp` (10 min) → `oauth.v2.access` → upsert `connections` for `state.userId` → 302 `${APP_BASE_URL}/setup?slack=ok` |
| GET | `/api/integrations/:id/entities` | people | → `{ people: [{ id, name }] }` from `users.list` (humans only) |
| PUT | `/api/tracked-entities` | set the one tracked sender | `{ connectionId, externalEntityId, displayName }` → `{ entity }` (MVP: replaces any existing person) |
| POST | `/api/telegram/pairing-code` | pairing | → `{ code, expiresAt, deepLink: "https://t.me/<bot>?start=<code>" }` |
| PATCH | `/api/preferences` | update | partial `{ targetLanguage?, timezone?, replyTone? }` → full preferences |
| GET | `/api/messages` | history | `?limit=50` → `{ items: [{ id, sender, preview, urgency, jobStatus, isMock, hasVideo, replyStatus, receivedAt }] }` |
| GET | `/api/messages/:id` | detail | → `{ message, job (with stageTimings), artifact: { videoUrl, renderMode, interpretation }, drafts }` |
| POST | `/api/messages/:id/retry` | retry | → `{ job }`; 409 unless `failed` |
| POST | `/api/replies/:id/approve` | approve + send | `{}` → see example below |
| POST | `/api/replies/:id/regenerate` | new draft | `{ tone? }` → `{ draft }` |
| POST | `/api/demo/inject` **no bearer, header `x-demo-secret`** | inject fixture | `{ fixture, userId }` → `{ messageId, jobId, isMock: true }` |
| POST | `/webhooks/slack/events` | Slack | → `200 {}` within 3 s; `{ challenge }` for `url_verification` |

### Example: Slack Events envelope (`fixtures/slack/professor_deadline.json`)

```json
{
  "token": "PLACEHOLDER_VERIFICATION_TOKEN",
  "team_id": "T0000EXAMPLE",
  "api_app_id": "A0000EXAMPLE",
  "type": "event_callback",
  "event_id": "Ev0000EXAMPLE1",
  "event_time": 1757772131,
  "event_context": "1-message-T0000EXAMPLE-D0000EXAMPLE",
  "authorizations": [
    { "enterprise_id": null, "team_id": "T0000EXAMPLE", "user_id": "U0000STUDENT", "is_bot": false, "is_enterprise_install": false }
  ],
  "event": {
    "type": "message",
    "channel": "D0000EXAMPLE",
    "channel_type": "im",
    "user": "U0000PROFESSOR",
    "text": "Hi Jack — because Monday is a university closure, the project deadline has moved from Monday at 11:59 PM to Friday at 5:00 PM. Submit the PDF to Quercus, but send your source-code repository link directly to me in Slack. Do not upload the repository archive to Quercus. Let me know by Wednesday if your group needs an extension.",
    "ts": "1757772131.000200",
    "event_ts": "1757772131.000200",
    "client_msg_id": "00000000-0000-0000-0000-000000000000"
  }
}
```

### Example: Telegram `callback_query` update (Reply tap)

```json
{
  "update_id": 900000001,
  "callback_query": {
    "id": "4382000000000000001",
    "from": { "id": 111111111, "is_bot": false, "first_name": "Jack", "language_code": "zh-hans" },
    "message": { "message_id": 512, "chat": { "id": 111111111, "type": "private" }, "date": 1757772300, "video": { "file_id": "PLACEHOLDER" } },
    "chat_instance": "-1234567890123456789",
    "data": "r:6f1a2b3c"
  }
}
```

### Example: `POST /api/replies/6f1a2b3c-…/approve`

Request: `{}` (bearer token identifies the user; the draft's `user_id` must match).

Response on success:

```json
{ "draft": { "id": "6f1a2b3c-0000-4000-8000-000000000000", "status": "sent", "approvedAt": "2026-09-13T14:07:02Z", "sentExternalMessageId": "1757772422.000300", "channel": "D0000EXAMPLE", "threadTs": "1757772131.000200" } }
```

Response when a second tap races the first: `409 { "error": { "code": "already_handled", "message": "Draft is already sent" } }`. When Slack failed: `200 { "draft": { "status": "failed", "errorDetail": "channel_not_found" } }`. When the response was lost: `200 { "draft": { "status": "send_uncertain" } }` (see §15).

---

## 10. Slack and Telegram behavior (MVP)

### Slack app

- Single-workspace app in a team-owned workspace. **User scopes:** `im:history` (required for `message.im` **[verified]**), `im:read`, `users:read`, `chat:write`. **User events:** `message.im`. Request URL `${API_BASE_URL}/webhooks/slack/events`; ngrok must be up before saving.
- Store `authed_user.access_token` (xoxp) encrypted, `authed_user.id`, `team.id`. Events arrive with `authorizations[].user_id` = the student **[verified]**. The app sees only conversations the authorizing student can see, and the server drops everything not from the single tracked sender before storing anything.
- Reply: `chat.postMessage` with the user token, `channel` = DM id, `thread_ts` = the professor's message `ts` (parent, never a reply's ts **[verified]**). The message appears as the student.
- **Hour-1 decision point (task 4):** if a DM does not reach the webhook within 15 minutes of correct setup, switch to bot mode: add bot scopes `channels:history, channels:read, chat:write, users:read`, create `#demo-class`, invite the bot, track the channel, set `connections.mode='bot_token'`. **Cost:** approved replies then post as the bot, not the student, prefixed `On behalf of <student name>:`, and the pitch says so.

### Telegram bot

| Trigger | Behavior |
| --- | --- |
| `/start <code>` | validate unused, unexpired code → upsert `connections(provider='telegram', external_account_id=chat_id)` + `telegram_sessions` → "Paired ✅" |
| reel delivered | `sendVideo` (bytes, ≤ 20 MB target; hosted Bot API upload cap believed 50 MB **[unverified]**) with caption `🎬 <sender> · Slack · <urgency>\n<shortTitle>\nAI-assisted translation` + keyboard `[📄 Original] [✅ Actions]` / `[✍️ Reply] [👍 Got it]` |
| `📄 Original` | verbatim original in `<pre>`, sender + time |
| `✅ Actions` | **all** action items: `1. <text> — 📅 <dueText> — "<evidenceQuote>"`; negations prefixed 🚫; then `⚠️ Unclear:` ambiguities |
| `✍️ Reply` | `state='awaiting_reply'`; prompt in Chinese and English |
| text while `awaiting_reply` | draft → show `你写的: …` / `English draft: …` / `意思核对: …` + `[📤 Send] [🔁 Regenerate] [❌ Cancel]` |
| `📤 Send` | atomic approve (§4.5) → Slack → "Sent ✅ in the thread under <sender>'s message" |
| text while idle | "Tap ✍️ Reply under a reel first." |

**Callback ownership check (every callback):** `chat_id = callback_query.message.chat.id` → `telegram_sessions.user_id`; resolve the id prefix in `data` to a row **with the same `user_id`**; if none, `answerCallbackQuery("Not available")` and log. Callback data (≤ 64 bytes **[verified]**): `o:<id8>`, `a:<id8>`, `r:<id8>`, `k:<id8>` for messages; `s:<id8>`, `g:<id8>`, `c:<id8>` for drafts.

---

## 11. LLM prompts and faithfulness policy

Calls: `client.messages.parse({ model: "claude-opus-5", max_tokens: 8192, output_config: { effort: "medium", format: zodOutputFormat(MessageInterpretationSchema) }, ... })` for interpretation; `effort: "low"`, `max_tokens: 2048` for reply drafts. Guard `parsed_output === null` and `stop_reason === "refusal"` → one retry turn, then `failed(LLM_INVALID)`. `{{timezone}}` comes from `preferences.timezone`; `{{today}}` is the server clock formatted in that timezone.

### 11.1 Interpretation system prompt

```text
You are ReelRelay's comprehension engine. Convert one incoming message into a faithful structured interpretation for a university student who reads {{targetLanguageName}} more comfortably than English. Today is {{today}} ({{timezone}}). Sender: {{senderDisplayName}}. Student: {{studentName}}.

RULES
1. Never invent facts. Anything not in the message is not in your output.
2. Preserve exactly: names, dates, weekdays, times, amounts, addresses, URLs, codes (course, room, ID), quantities, requirements, negations ("do not", "no longer", "unless"), consequences. Copy them verbatim into preservedFacts and keep them unchanged in translations. Keep platform and product names (Quercus, Slack, GitHub) untranslated.
3. faithfulTranslation: the whole message in {{targetLanguageName}}, same order, nothing dropped or added.
4. actionItems: one per instruction, request, or deadline. essential=true when the item is a deadline, a changed date/time, a requirement (must/need to/submit/send), or a negation. isNegation=true for "do not / never" instructions and text must start with the {{targetLanguageName}} equivalent of "Do NOT". evidenceQuote is a verbatim substring of the original English. dueText is the verbatim time phrase or null. dueAt is ISO 8601 in {{timezone}} only if unambiguous given today; otherwise null and add the issue to ambiguities.
5. spokenSegments: the narration, in {{targetLanguageName}}, split into ordered caption chunks of at most 25 characters (CJK) or 12 words each. It must (a) state what changed, (b) mention EVERY essential action item with its dueText, (c) mention non-essential items briefly or say how many more are in the action list. Target 60–110 words English-equivalent; never exceed 140. Do not include the hook.
6. hook: one line (≤ 60 chars) saying why this matters, e.g. "重要：作业截止日期已更改". It is displayed, not spoken.
7. ambiguities: state uncertainty explicitly ("'Wednesday' could be this week or next"). Do not resolve ambiguity by guessing.
8. Do not give legal, academic, immigration, housing, financial, medical, or safety advice. Suggest clarifying questions instead.
9. isSensitive=true for grades/integrity, money owed, housing/eviction, employment status, health, immigration, legal, or personal conflict.
10. Output only the JSON object.
```

User content: `<message>{{originalText}}</message>` plus `<thread_context>` when present. Retry turn appends: `Your previous JSON failed these checks:\n{{issues}}\nReturn corrected JSON only. Do not change any facts.`

### 11.2 Faithfulness checks (`engine/faithfulness.ts`)

Two tiers. Tier A is deterministic and gates the job; Tier B needs a human and happens in rehearsal.

**Tier A — deterministic (job fails → retry turn → `failed`)**

| Check | Rule |
| --- | --- |
| A1 evidence | every `actionItems[].evidenceQuote` is a whitespace-normalized, case-insensitive substring of the original |
| A2 essential coverage in narration | for every `essential` action item, its `dueText` (if any) and at least one anchor token appear in `spokenSegments.join("")`. Anchor tokens: the numeric part of times/dates from `dueText` (`5`, `00`, `Friday`→ localized weekday from a per-language table), platform names, and for negations the negation marker from a per-language list (`不要|不得|勿|请勿|不能` for zh) |
| A3 negation | if the original matches `/\b(do not|don't|never|no longer|must not)\b/i`, at least one action item has `isNegation=true` |
| A4 facts | every time expression (`\d{1,2}(:\d{2})?\s?(AM|PM)`), URL, and currency amount in the original appears verbatim in `faithfulTranslation` or `preservedFacts[].value` |
| A5 date change | if the original contains "moved from … to …" / "changed … to …" / "instead of …", at least two distinct `dueText` values or a `preservedFacts` entry labeled `old_deadline` exist |
| A6 action card | rendered action card pages contain **every** action item (asserted by the renderer from props, not the LLM) |

Note: A2 and A4 can false-positive when times are localized (e.g. `晚上11:59` for `11:59 PM`). The check normalizes digits and strips AM/PM before comparing; one tuning pass on the six fixtures is budgeted inside task 8.

**Tier B — semantic accuracy (human review, rehearsal checklist)**

A bilingual teammate reads `faithfulTranslation` and the narration for each fixture and marks: meaning preserved, no added commitments, negation preserved, tone appropriate. Results go on the pitch card as "N of 6 fixtures fully faithful on human review". Tier B is never claimed as automated.

### 11.3 Narration length policy (replaces audio truncation)

- No audio is ever cut. Reel length = narration + 9.8 s of cards.
- If `narrationMs > 40 000`: re-run interpretation once with the extra instruction "spokenSegments must be under 80 words: keep every essential item and its dueText, compress everything else to one sentence, and end with '还有 N 项，请查看操作列表' (N = count of non-essential items not spoken)".
- If still over 40 s, accept it (cap 60 s) rather than drop an essential item.
- Essential items always appear in narration, captions, **and** the action card; non-essential items always appear in the action card and the `Actions` button. The action card pages through all items, three per page.

### 11.4 Reply-draft system prompt

```text
You draft English replies for a university student who writes in their own language. Produce what they would send if fluent in English.
1. Translate the student's meaning faithfully. Add no commitments, apologies, excuses, or facts they did not express. Remove nothing.
2. Tone {{tone}}: respectful_student = polite, formal greeting using the sender's title ("Hi Professor Chen,"), sign-off, no slang. concise_professional = brief and courteous. warm = friendly, appreciative. direct = shortest faithful version.
3. Keep the original message's facts exact (dates, times, names, platforms). Dates or times the student wrote stay exactly as written.
4. If the student did not answer a question the sender asked, add a warning in {{targetLanguageName}} in warnings; do NOT answer for them.
5. meaningCheck = one sentence in {{targetLanguageName}} paraphrasing the English draft.
6. Sign as {{studentName}}. Never mention AI or translation in the draft.
7. Output only the JSON object.
```

User content: `<original_message sender="…">…</original_message><interpretation_summary>…</interpretation_summary><student_reply_original>…</student_reply_original>`. Every draft shown in Telegram carries the label `AI-assisted draft — review before sending`.

---

## 12. Reel composition specification

Composition `Reel`, 720x1280 at 30 fps (1080p is stretch). One template, calm background: slow radial gradient drift plus soft grain, deterministic via `random(seed)`. No third-party footage.

### Timeline (all offsets from t = 0)

| Segment | Time | Content | Audio |
| --- | --- | --- | --- |
| Intro chip | 0–1.2 s | background fades in; chip `Professor Chen · Slack`; urgency pill | silent |
| Hook card | 1.2–3.5 s | `hook` at 56 px bold, slides up; **not spoken** | silent |
| Body | 3.5 s → 3.5 s + narrationMs | `captionSegments` one at a time, ≤ 2 lines, 44 px, white with dark stroke on a 60 % black plate | TTS starts at exactly 3.5 s |
| Action card | body end + 0.3 s, 3.5 s per page | page k shows items 3k..3k+2: `✅/🚫 <text>` + `📅 <dueText>`; page indicator `1/2` | silent |
| Outro | 2.0 s | `用中文回复 · 点 ✍️` + `AI 辅助翻译` | silent |

`totalMs = 3500 + narrationMs + 300 + 3500 × ceil(actions / 3) + 2000`. For the demo message (4 actions, ~28 s narration) that is about 44 s.

### Caption timing (`tts/timing.ts`)

1. `spokenText = spokenSegments.join(" ")` (CJK: join with no space). Send to ElevenLabs `/with-timestamps`; read `alignment.characters`, `character_start_times_seconds`, `character_end_times_seconds` **[verified fields]**.
2. Walk the characters, matching each segment's non-whitespace characters in order; `startMs = first char start × 1000 + 3500`, `endMs = last char end × 1000 + 3500`. Enforce `endMs − startMs ≥ 700` and no overlap (push the next start). `narrationMs = last char end × 1000`.
3. **No alignment (TTS error or key missing):** `captions_only`; per segment `2200 + 90 ms × CJK chars (or 60 ms × Latin chars)`, offsets from 3500; silent.
4. Hook offset is never added to captions; the hook is a separate card.

### Rendering

`RemotionRenderer`: `bundle()` once at boot → `selectComposition({ id: "Reel", inputProps })` → `renderMedia({ codec: "h264", crf: 26, audioCodec: "aac", concurrency: 2, timeoutInMilliseconds: RENDER_TIMEOUT_MS })` **[verified API; default timeout is 30 s and must be raised]**. Action card asserts every action item is present in its props (check A6). Fonts: `NotoSans-Bold` and `NotoSansSC-Bold` via `@remotion/fonts`. Failure → `text_only` card in Telegram (hook, narration text, full action list). FFmpeg renderer is stretch.

---

## 13. Implementation tasks (dependency order)

Each row: goal · owner · dependencies · estimate. **P** = parallelizable once dependencies are met. Acceptance criteria follow the table.

| # | Task | Owner | Deps | Est | P |
| --- | --- | --- | --- | --- | --- |
| 0 | Accounts + apps: Supabase project, Slack app (scopes/events/redirect), BotFather bot, ngrok reserved domain, keys into `.env` | B | – | 40 m | P |
| 1 | Monorepo skeleton (`pnpm dev` starts web + server), `.nvmrc`, `.env.example`, Remotion package init | A | – | 40 m | P |
| 2 | Shared Zod contracts + interfaces (§8, §4.2) | A | 1 | 30 m | P |
| 3 | Migration + `crypto.ts` + `oauthState.ts` + server boot (`config.ts`, `requireUser`, `Queue`, `/health`) | A | 1, 2 | 50 m | – |
| 4 | Slack OAuth start/callback + events webhook (verify, ack, filter to one tracked sender, idempotent persist, enqueue). **Includes hour-1 decision point.** | B | 0, 3 | 90 m | – |
| 5 | Entities list + `PUT /api/tracked-entities` | B | 4 | 30 m | P |
| 6 | Telegram bot: pairing, sessions, `/start`, `/help`, ownership check helper | B | 3 | 45 m | P |
| 7 | Remotion `Reel` composition with static sample props: chip, hook, captions, paged action card, outro, fonts | C | 1 | 90 m | P |
| 8 | `ClaudeEngine.analyze` + prompts + faithfulness Tier A + fixtures + tuning pass | A | 2 | 90 m | P |
| 9 | ElevenLabs TTS + timing + captions-only fallback | A | 2 | 40 m | P |
| 10 | `RemotionRenderer` + upload + signed URL; measure render time | C | 7, 9 | 45 m | – |
| 11 | Worker `generateReel` with stage timings and failure modes | A | 3, 8, 9, 10 | 40 m | – |
| 12 | `TelegramDelivery`: `sendVideo`, keyboard, `Original`, `Actions`, `Got it` | B | 6, 11 | 40 m | – |
| 13 | Reply flow: `Reply` state, `draftReply`, atomic approve, `Regenerate`, `Cancel` | B | 8, 12 | 60 m | – |
| 14 | `SlackConnector.sendReply` (thread) + `/api/replies/:id/approve` + `send_uncertain` reconcile | B | 4, 13 | 40 m | – |
| 15 | Demo injector + `scripts/inject-demo.ts` + MOCK flag | A | 11 | 25 m | P |
| 16 | Web: auth + API client + Setup page (Slack card, Telegram card, sender picker, language) | C | 3, 5, 6 | 75 m | P |
| 17 | Web: History list + detail (status polling 3 s, video, original, actions, drafts, retry, MOCK badge) | C | 11 | 60 m | P |
| 18 | `scripts/smoke-e2e.ts` latency measurement (3 runs, per-stage) | A | 11, 12 | 20 m | P |
| 19 | Tests: verify, filter, idempotency, faithfulness, approval gate, ownership, authz | A | 4, 8, 13 | 60 m | P |
| 20 | Hardening: force each failure mode, retry path, bot restart | A+B | 14 | 40 m | – |
| 21 | Stretch (only after M4): playful background, `Edit`, tone picker, landing page, 1080p | C | M4 | – | P |
| 22 | Backup recording `demo/backup.mp4` from a real run | C | 14, 17 | 20 m | – |
| 23 | Pitch card: latency numbers, Tier B results, Challenge 2 rows | all | 18, 19 | 20 m | – |
| 24 | Rehearsal ×2 | all | 22, 23 | 60 m | – |

### Acceptance criteria

- **3** `/health` 200; `/api/preferences` 401 without bearer; `encrypt(decrypt(x)) === x`; signup trigger creates `users` + `preferences`.
- **4** bad signature → 401; stale timestamp → 401; challenge echoed; same `event_id` twice → one `messages` row and one job; untracked sender → no row; ack < 500 ms; OAuth lands on `/setup?slack=ok`; tampered `state` → 400.
- **6** second use of a code rejected; callback for another user's message → "Not available".
- **7** `remotion preview` shows sample props; 4 actions render as 2 pages; CJK captions ≤ 2 lines at 720 px.
- **8** professor fixture with `zh-CN`: 4 action items, one `isNegation`, `dueText` includes "Friday at 5:00 PM" and "Wednesday", all Tier A checks pass; `ambiguous_date` yields non-empty `ambiguities`; **interpretation completes in under 12 s on 3 consecutive runs, otherwise drop `effort` to `"low"`**; a test injecting a bad first response exercises the retry turn.
- **9** returns `{ audioPath, narrationMs, captionSegments }`; segments non-overlapping; no key → `captions_only`.
- **10** sample props → MP4 ≤ 20 MB with audio in ≤ 60 s wall time on the demo laptop; slower → set `concurrency` to CPU count or raise `crf`; still slower → apply the pitch pacing in §18.
- **11** statuses observed in order in DB; `stage_timings` populated; each failure mode yields the §15 outcome; unique index blocks a second job.
- **12** video plays inline; `Original` is byte-exact; `Actions` lists all 4 items with evidence; buttons work after bot restart.
- **13** draft text while idle rejected; two rapid `Send` taps → exactly one Slack message (test with a mocked connector counting calls); `sendReply` unreachable from any handler except approve (grep + test).
- **14** reply appears threaded under the professor's DM; `ts` stored; failure → `failed` with retry; simulated lost response → `send_uncertain` then reconciled.
- **16/17** setup completes in ≤ 5 clicks; history polls while non-terminal; MOCK badge on injected messages.

---

## 14. Testing checklist

**Unit (no network):** signature (valid, tampered, stale, missing); OAuth state (round-trip, expired, bad HMAC); filter (tracked person, untracked, bot, subtype); normalize (DM fixture → `NormalizedMessage`, `external_message_id`, thread id); schema parse of expected interpretation; faithfulness A1–A5 on crafted good/bad cases including localized time `晚上11:59`; timing mapping + fallback; crypto round-trip; **approval**: `sendReply` called once for two concurrent approves, never from draft/regenerate/cancel; ownership: foreign callback rejected; authz: foreign message id → 404.

**Integration (skipped without keys):** engine on six fixtures satisfies Tier A; TTS returns alignment for a zh string; Remotion renders sample props ≤ 60 s; duplicate Slack event → one job; retry from `failed` reaches `complete`.

**End-to-end (manual, timed):** definition of done (§20) twice; injector path once; bot restart mid-flow; hour-4 checkpoint run logged by `smoke-e2e.ts`.

---

## 15. Failure, retry, and demo fallbacks

| Failure | Behavior | Student sees |
| --- | --- | --- |
| Duplicate Slack event / retry (`x-slack-retry-num`) | `ON CONFLICT DO NOTHING` → no job | nothing |
| User-scope events not delivered | bot mode; reply appears from the bot with prefix `On behalf of <student name>:`; demo script says so | reply from bot |
| LLM invalid / Tier A failure | one retry turn; then `failed(LLM_INVALID)` | History: Failed + Retry; Telegram: original text + "translation unavailable" |
| LLM refusal (`stop_reason: refusal`) | same as above with `LLM_REFUSED` | same |
| LLM slow (> 12 s on 3 runs at task 8) | set `effort: "low"` for interpretation; keep model | faster reel |
| Narration > 40 s | one shorter regeneration keeping all essential items; else accept up to 60 s | slightly longer reel |
| TTS failure / no key | `captions_only` | silent captioned reel |
| Remotion error / timeout (150 s) | `text_only` card immediately; retry available | text card with hook, narration, all actions |
| Video > 20 MB | re-render `crf: 30`; > 50 MB → send signed link | link |
| Telegram send error | retry 3× (1, 3, 9 s) → `failed(DELIVERY)` | History retry |
| Slack reply error with response | `failed`, `error_detail`; `Retry send` button | "Couldn't send — retry" |
| Slack reply timeout / lost response | `send_uncertain`; reconcile: `conversations.replies(channel, thread_ts)` for a message from the student with identical text posted after `approved_at` → if found mark `sent` with its `ts`; else offer `Retry send` (approve row already exists, so retry re-calls `sendReply` only from `send_uncertain`) | "Checking…" then result |
| Token revoked | `connections.status='error'`; Setup shows Reconnect | reconnect |
| ngrok / OAuth broken at judging | `pnpm demo:inject professor_deadline` (labeled MOCK in History and in the Telegram caption `⚠️ demo-injected`) | reel still real |
| Everything broken | play `demo/backup.mp4`, announced as PRERECORDED | recording |

Retry rule: `POST /api/messages/:id/retry` allowed when `failed` and `attempt_count < 3`; resumes from the earliest missing artifact (`interpretation_json`, `audio_path`, `video_path`).

---

## 16. Security and privacy checklist

- [ ] Slack token AES-256-GCM encrypted; key in env; never logged.
- [ ] Signature + timestamp verified on the raw body before parsing; timing-safe compare.
- [ ] OAuth `state` signed with `OAUTH_STATE_SECRET`, carries `userId`, expires in 10 min; redirect URI fixed.
- [ ] Only the single tracked sender is persisted; everything else dropped pre-storage. The app cannot and does not read chats the student cannot see, nor Telegram chats outside the bot.
- [ ] Telegram callbacks pass the ownership check; polling mode exposes no public route.
- [ ] Demo injector requires `x-demo-secret`; injected rows carry `is_mock=true` and are labeled everywhere.
- [ ] Every API query scoped by `user_id`; foreign ids → 404 (tested).
- [ ] Bucket private; 1-hour signed URLs; Telegram receives bytes.
- [ ] Logs truncate message bodies to 80 chars; no tokens.
- [ ] Only the approve handler calls `sendReply`; approval is an atomic conditional `UPDATE` (tested).
- [ ] "AI-assisted" label on reel caption and every draft; copy states Anthropic and ElevenLabs process text; no end-to-end-encryption claim.
- [ ] Data deletion: `DELETE /api/integrations/:id` cascades (API only in MVP; button is stretch).

---

## 17. Team allocation

### 3 developers (baseline) — ownership: A = pipeline/engine, B = Slack/Telegram/reply, C = reel/web

| Hour | A | B | C | Checkpoint |
| --- | --- | --- | --- | --- |
| 0–1 | 1 (40) → 2 (30) started | 0 (40) + ngrok + workspace accounts | Remotion init, fonts, sample props (task 7 start) | **M0 (1:00):** `pnpm dev` runs; keys in `.env`; Slack app saved |
| 1–2 | 2 finish, 3 (50) | 4 OAuth (first 60) | 7 continue | – |
| 2–3 | 8 engine (first 60) | 4 events + **hour-1 decision** (slip allowed to 2:45) | 7 finish (90 total) | **M1 (3:00):** real DM → `messages` row + queued job; engine returns valid JSON for professor fixture |
| 3–4 | 8 finish, 9 (40) | 6 Telegram (45), 5 (30) | 10 renderer (45) | **M2 (4:00): rough E2E** — inject or real DM → reel in Telegram (text_only acceptable) → `Reply` → draft → approve → threaded Slack post. Uses stub draft if 13 unfinished. |
| 4–5 | 11 worker (40), 18 latency (20) | 12 delivery (40) | 16 setup page (75) | first latency numbers recorded |
| 5–6 | 15 injector (25), 19 tests start | 13 reply flow (60) | 16 finish, 17 history start | – |
| 6–7 | 19 tests (60 total) | 14 send + reconcile (40) | 17 history (60) | **M3 (7:00): full definition of done passes once with real Slack** |
| 7–8 | 20 hardening | 20 hardening | 22 backup recording (20), 17 polish | – |
| 8–9 | 8 tuning pass, Tier B review | reply polish, bot restart test | UI polish | **M4 (9:00): DoD passes twice; latency ≤ target** |
| 9–10.5 | 23 pitch card | stretch: `Edit` | stretch: playful bg or 1080p | – |
| 10.5–12 | 24 rehearsal | 24 | 24 | freeze at 11:15 |

Estimates per dev: A ≈ 425 min of tasks in 540 min; B ≈ 385 in 540; C ≈ 390 in 540. The remainder is integration and debugging slack, deliberately.

**Slip rules (apply in order):**
1. M1 late by > 45 min → C stops Remotion polish at "captions + one action page" and helps B with events.
2. M2 late by > 60 min → tasks 16 and 17 shrink to one combined page; `Regenerate` cut.
3. M3 late by > 60 min → tests limited to signature, idempotency, approval gate; Tier B review cut to the professor fixture only.
4. Render > 90 s at task 10 → 720p `crf: 30`, `concurrency` = cores; still > 90 s → pitch uses the pre-sent message (§18) and the live send shows status only.
5. Never cut: approval gate, `Original` + `Actions` buttons, MOCK labeling.

### 2 developers (if it comes to that)

| Hour | A (pipeline + reel) | B (connectors + web) |
| --- | --- | --- |
| 0–1 | 1, 2 (70 → spills 10 min) | 0, ngrok |
| 1–3 | 3, 8 (140 → tight, tuning pass deferred) | 4, 6 |
| 3–5 | 7 trimmed to 90 (single action page + chip), 9 | 5, 12 stub, 16 |
| 5–7 | 10, 11, 15 | 13, 14 |
| 7–9 | 18, 19 (approval + idempotency only) | 17, 20 |
| 9–10.5 | 22, 23 | reply polish |
| 10.5–12 | 24 | 24 |

Cut first for 2 devs: FFmpeg renderer (already stretch), landing page, preferences beyond language, `Regenerate`, Tier B beyond one fixture. Critical path stays: 0–4, 6–14, 16–17, 22, 24.

### 4 developers

D takes 16, 17, 22 and the landing page from hour 1; C focuses on 7, 10, and render speed; A gains time for the tuning pass and the full test list; B unchanged.

---

## 18. Demo timing, rehearsal, and pitch

### Performance targets (measured at M2, re-measured at M4)

| Stage | Target | Fallback if missed |
| --- | --- | --- |
| Slack event → job queued | ≤ 2 s | – |
| analyzing | ≤ 12 s | `effort: "low"` |
| voicing | ≤ 10 s | – |
| rendering (720p, ~44 s reel) | ≤ 60 s | `crf: 30`, more concurrency; else pre-sent message in pitch |
| delivering | ≤ 5 s | – |
| **Total** | **≤ 90 s** | pitch structure below already tolerates 120 s |
| draft generation | ≤ 6 s | – |
| approve → Slack | ≤ 3 s | – |

Numbers go on the pitch card as measured, not as targets.

### Pitch structure (fits measured behavior)

Two messages are used: message **1** was sent 3 minutes before the pitch and is already delivered; message **2** is sent live at 0:10 and is visible processing on the History page throughout.

1. **0:00–0:15** Problem: dense English DM with a moved deadline and a "do NOT". Professor sends message 2 live; History shows `Analyzing`.
2. **0:15–0:50** Play message 1's reel on the phone (state it was sent three minutes ago). Tap `Actions`: Friday 5:00 PM, Wednesday, PDF to Quercus, do NOT upload the archive. Tap `Original`.
3. **0:50–1:15** Type a Mandarin clarification. Show the draft with meaning check. Tap `Send`. Show the threaded reply in Slack.
4. **1:15–1:30** Point at History: message 2 has reached `Rendering`/`Delivered` (measured ≈ N s). Close: "The sender changed nothing; ReelRelay changed the format, place, language, tone, and timing for the recipient, without sending anything unapproved or hiding the original."

If ngrok or OAuth breaks: the injector sends message 1 and the presenter says "this event is injected from a saved Slack payload". If everything breaks: play `demo/backup.mp4`, announced as prerecorded.

### Rehearsal checklist (hour 10.5+)

- [ ] ngrok up; Slack Request URL verified; `/health` public.
- [ ] Student account connected (mode noted: user or bot); professor tracked; a real DM produced a reel within the last 30 min.
- [ ] Telegram paired; polling running; old buttons still work after restart.
- [ ] Message 1 pre-sent 3 min before the slot; message 2 text in the professor's clipboard.
- [ ] `pnpm demo:inject professor_deadline` tested; `demo/backup.mp4` plays.
- [ ] Latency numbers from `smoke-e2e.ts` (3 runs) and Tier B results on the pitch card.
- [ ] Challenge 2 criteria rows added or explicitly marked unknown.

---

## 19. Post-hackathon extensions (not MVP)

Gmail connector; channel and multi-sender tracking; more languages and voices; playful/timeline templates and 1080p; FFmpeg fallback renderer; in-place `Edit` and tone picker; urgency reminders; comprehension check; AI-generated backgrounds; Instagram professional-account adapter (Meta app review; never in the critical path); Discord/WhatsApp delivery; BullMQ worker container and hosted deployment; word-level caption highlighting; disconnect/delete UI.

---

## 20. Definition of done and chronological checklist

### Definition of done (all twelve, real Slack, twice in a row)

1. User signs in with a magic link.
2. User connects Slack; `connections` row exists with an encrypted token.
3. User pairs Telegram with a one-time code.
4. User selects one Slack sender to track.
5. A DM from that sender arrives.
6. Exactly one `processing_jobs` row is created, even when Slack retries.
7. Within the measured target (≤ 90 s), Telegram receives a captioned, narrated 9:16 video in Chinese (or a labeled text card in a fallback mode).
8. `Original` shows the exact text; `Actions` shows every action item with due text and evidence, including the negation.
9. User writes a reply in Chinese.
10. Bot shows an English draft in the respectful student tone with a meaning check.
11. Nothing is posted to Slack before `Send`; a double tap posts once.
12. The approved text appears as a threaded reply under the sender's DM, from the student (or from the bot with the "On behalf of" prefix in bot mode, stated in the pitch).

### Chronological checklist

- **0:00–1:00** — B: Supabase project, Slack app (user scopes `im:history im:read users:read chat:write`, event `message.im`), BotFather bot, ngrok reserved domain, `.env` filled and shared. A: task 1 then 2. C: Remotion init + fonts + sample props. **M0.**
- **1:00–3:00** — A: 3, then 8. B: 4 with the hour-1 decision point (user events vs bot mode). C: 7. **M1.**
- **3:00–4:00** — A: 8 finish, 9. B: 6, 5. C: 10. **M2 rough end-to-end; record first latency.**
- **4:00–7:00** — A: 11, 18, 15, 19. B: 12, 13, 14. C: 16, 17. **M3 full DoD once.**
- **7:00–9:00** — all: 20 hardening; A: tuning pass + Tier B; C: 22 backup. **M4 DoD twice, latency ≤ target.**
- **9:00–10:30** — 23 pitch card; stretch only if M4 passed.
- **10:30–12:00** — 24 rehearsal ×2; freeze at 11:15; Challenge 2 rows added or marked unknown.

---

## 21. Revision notes

### What changed and why

- **Scope cut to one sender, one language, one template.** The previous plan carried two backgrounds, five preferences, an FFmpeg renderer, `Edit`, tone picker, and a landing page on the critical path. None are needed to prove the flow; they moved to stretch (task 21) and §19.
- **Schedule rebuilt on dependencies with checkpoints.** The old hour-0 cell for Dev A held 100 minutes of work; the 2-dev table had 165 minutes in a 120-minute slot. The new table sums per dev (≈ 385–425 min of tasks in 540 min), leaves integration slack, targets a rough end-to-end at hour 4 (M2), and lists ordered slip rules.
- **Faithfulness now checks what the student actually sees.** Action items carry `essential` and `isNegation` flags; Tier A checks narration/caption coverage (A2), negation (A3), date change (A5), and the rendered action card (A6). The action card pages through every item instead of showing three. Audio truncation is replaced by a shorter-regeneration policy that never drops an essential item. Semantic accuracy is explicitly a human-review tier.
- **Auth and send behavior resolved.** OAuth start returns a URL with identity in the signed state because redirects cannot carry a bearer; the callback is unauthenticated by design. Telegram callbacks are checked against the chat's `user_id`. Approval is an atomic conditional `UPDATE`, and a lost Slack response goes to `send_uncertain` with a reconcile step.
- **Demo timing made credible.** Explicit per-stage targets, a latency measurement at hour 4, and a pitch that plays a message sent three minutes earlier while the live one processes on screen. Injected and prerecorded paths are labeled.
- **Self-contained.** Interfaces, definition of done, and prompts are in the document; the earlier reel timeline contradiction (narration at 1.2 s vs captions at 3.5 s) is fixed: the hook is silent, narration and captions both start at 3.5 s.
- **Earlier review fixes folded in:** `effort: "medium"` / `"low"`, `max_tokens` 8192, 12-second acceptance criterion, bot-mode reply cost, `timezone` preference feeding `{{timezone}}`/`{{today}}`, example payloads, RLS rationale, localized-time false-retry note. `playback_speed` was dropped rather than wired: ElevenLabs exposes `voice_settings.speed` but its range is unverified, and reading pace is better controlled by the narration word budget.

### Required MVP versus stretch

See §1 table. Required: sign-in, Slack user-token OAuth + `message.im`, one tracked sender, Telegram pairing, `zh-CN` interpretation with Tier A checks, ElevenLabs narration with captions-only fallback, one calm 720p template with paged action card, `Original`/`Actions`/`Reply`/`Got it`, draft + atomic approve + threaded Slack reply, Setup and History pages, injector and backup. Stretch: everything in task 21 and §19.

### Remaining assumptions and blockers

- **Unknown:** Challenge 2 judging criteria (§2).
- **[unverified]** Remotion license threshold for a 3-person team; Telegram hosted upload cap (believed 50 MB; plan targets 20 MB regardless); ElevenLabs `speed` range (not used in MVP); ElevenLabs free-tier character quota may not cover 6 fixtures × several runs (budget a paid tier).
- **Assumed:** user-scope `message.im` events arrive for the authorizing student (documented **[verified]**, but the workspace must not restrict app installs); Remotion render of a 44 s 720p reel finishes in ≤ 60 s on the demo laptop (measured at task 10).
- **Slack rate limit:** `chat.postMessage` ~1 message/second/channel **[verified]**, irrelevant at demo volume.

### First five concrete actions

1. B creates the Slack app with user scopes `im:history im:read users:read chat:write`, event `message.im`, and the ngrok redirect URL; creates the Telegram bot; creates the Supabase project; fills `.env` (task 0).
2. A scaffolds the monorepo and shared Zod contracts so B and C compile against the same types by 1:10 (tasks 1–2).
3. C starts the Remotion `Reel` composition with the sample interpretation JSON from §9, including the paged action card (task 7).
4. B implements the Slack events route and sends a real DM from the professor account by 2:30 to make the user-token vs bot-mode decision (task 4).
5. A runs the professor fixture through `ClaudeEngine.analyze` and the Tier A checks, then records the interpretation latency over three runs (task 8).
