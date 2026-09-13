# PivotHacks — ReelRelay

Hackathon project repo (https://github.com/notjackl3/pivothacks). Team 10 · Communication Breakdown.

A student receives a message from one tracked sender → gets a translated, captioned vertical reel in Telegram →
replies in their own language → approves an English draft → it posts back into the source thread.
**Channels:** inbound is Composio-only (Gmail, Slack, Outlook, WhatsApp, Instagram) plus the direct Slack connector;
outbound is Telegram-only. The Instagram delivery connector was removed — see `COMPOSIO-SETUP.md` / `TELEGRAM-SETUP.md`.
**Pivot 03 (context):** urgency, deadline proximity, quiet hours and sender relationship decide *how and when* the
message is delivered (instant text card / normal reel / held digest). See `PLAN-PIVOT-03.md`.

## Stack

pnpm workspace + Turbo. Node ≥ 20.19, pnpm 10.

| Package | What | Runs on |
| --- | --- | --- |
| `apps/server` | Fastify API, Slack + Composio inbound, Telegram delivery, OpenAI/Claude engine, ElevenLabs TTS, Remotion render worker, triage scheduler | :4000 |
| `apps/web` | Next.js app: login (Supabase magic link), Setup, History | :3000 |
| `packages/shared` | zod contracts shared by both | – |
| `packages/reel` | Remotion composition for the 720x1280 reel | – |
| `supabase/migrations` | Postgres schema. `0001_init.sql` + `0002_context.sql` are applied on the hosted project; `0003_inbound_sources.sql` (Composio) is idempotent and still needs applying | – |

## Commands

```
pnpm install --frozen-lockfile
pnpm dev                         # web :3000 + server :4000 (log must show "worker: ready" and "scheduler: watching held jobs")
pnpm typecheck                   # all packages
pnpm exec tsx scripts/check-languages.ts --live # real translation, reply drafts, narration and MP4s for all five languages
pnpm test                        # server unit tests (vitest)
pnpm telegram:check              # validate TELEGRAM_BOT_TOKEN, register /start /help   (see TELEGRAM-SETUP.md)
pnpm demo:inject professor_deadline            # inject a fixture as the paired user (needs DEMO_INJECT_SECRET)
pnpm demo:inject manager_steps --at 23:10      # pin the triage clock → held until quiet hours end
pnpm demo:inject --clock 08:05 | --clock real  # move / reset the scheduler's demo clock
```

## Environment (`.env` at repo root, gitignored)

Copy `.env.example`. Already filled in on the dev machine: Supabase URL/keys, storage bucket `reels`, the three app
secrets, ElevenLabs. Still needed per developer:

| Key | Where to get it | Needed for |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | @BotFather → `/newbot` | delivery to the phone |
| `OPENAI_API_KEY` | platform.openai.com | interpretation + reply drafts; defaults to `gpt-5-mini` (`OPENAI_MODEL` overrides) |
| `ANTHROPIC_API_KEY` | console.anthropic.com | optional alternative; select with `ENGINE_PROVIDER=anthropic` |
| `SLACK_CLIENT_ID/SECRET/SIGNING_SECRET` | Slack app (scopes in `DEV-B-HANDOFF.md`), needs ngrok | real Slack messages; skip for the injected demo |
| `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET`, `COMPOSIO_AUTH_CONFIGS`, `COMPOSIO_TRIGGER_SLUGS` | Composio dashboard (`COMPOSIO-SETUP.md`), needs a public HTTPS webhook | inbound Gmail / Outlook / WhatsApp / Instagram / Slack messages |
| `DEMO_NOW` | optional ISO instant | freeze the triage clock for a stage demo |

Hosted Supabase project: `mcdacwrcompwsxtrskog` (Canada Central). Auth redirect allow-list already includes
`http://localhost:3000/auth/callback`.

`ENGINE_PROVIDER=auto` selects OpenAI when its key is configured, otherwise Anthropic.
The existing demo names `LLM_PROVIDER=openai` and `LLM_API_KEY` are accepted too.
`ENGINE_MODE=stub` explicitly uses fixtures instead of a live model. Vietnamese
narration automatically uses Eleven Flash v2.5 when the configured default is
Multilingual v2, which does not support Vietnamese. Korean captions use bundled
Noto Sans KR. See `fixtures/languages/README.md` for language verification details.

## Working conventions

- Work on `main`; keep commits small and descriptive. Push as the `vyttran-ctrl` GitHub account (`gh auth switch`).
- Do not commit secrets. `.env` is gitignored; document new keys in `.env.example` and here.
- Ownership: Dev A = pipeline/engine/worker/shared/migrations; Dev B = Slack/Composio/Telegram/reply/API/web.
- Use non-interactive commands (`--yes`) when scaffolding.
