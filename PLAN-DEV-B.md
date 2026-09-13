# PLAN-DEV-B — Connectors + Web (Slack, Telegram, reply flow, web app)

Read `PLAN.md` first; it holds every contract (endpoints §9, Slack/Telegram behavior §10, approval sequence §4.5, failure table §15). This file only says **what Dev B builds, in what order, and which files Dev B owns**. Dev A's file is `PLAN-DEV-A.md`. The two are designed so that you never edit the same file.

## Ownership (you may create and edit only these paths)

| Path | Notes |
| --- | --- |
| `apps/web/**` | Entire web app after A's `create-next-app` scaffold lands in the skeleton commit. |
| `apps/server/src/routes/webhooks/**` | Slack events route. `routes/webhooks/index.ts` exports `registerWebhooks(app)`; A's `index.ts` already imports it. |
| `apps/server/src/routes/api/index.ts` and `routes/api/{integrations,slack,entities,telegram,replies,preferences}.ts` | `registerApiRoutes(app)` registers yours **and** A's `messages.ts` / `demo.ts` (import them; do not edit them). |
| `apps/server/src/connectors/slack/**` | OAuth, verify, normalize, `SlackConnector`. |
| `apps/server/src/delivery/**` | `delivery/index.ts` (`getDelivery()`), `telegram/{bot,TelegramDelivery,keyboards,session,reply}.ts`. A's worker only calls `getDelivery()`. |
| `apps/server/src/db/queries/{connections,entities,drafts,telegram,preferences}.ts` | Your queries. A owns `messages`, `jobs`, `artifacts`. |
| `apps/server/test/{verify,oauthState,filter,normalize,approval,ownership}.test.ts` | Your tests. |
| `packages/shared/src/api.ts` | **Append-only** (request/response types for your endpoints). |

**Never touch:** root config files, `pnpm-lock.yaml` except via `pnpm add`, `packages/reel/**`, `packages/shared/**` other than appending to `api.ts`, `supabase/migrations/**`, `apps/server/src/{index,config}.ts`, `queue/**`, `worker/**`, `engine/**`, `tts/**`, `render/**`, `connectors/mock/**`, `security/**`, `auth/**`, `db/client.ts`, `db/queries/{messages,jobs,artifacts}.ts`, `routes/api/{messages,demo}.ts`, `fixtures/**`, `scripts/**`.

## What A gives you and when

| Time | From A | You use it for |
| --- | --- | --- |
| 1:10 | skeleton commit: monorepo, `packages/shared` contracts, migration SQL, `config.ts` with all env vars, stub files at your paths | pull, apply migration in Supabase SQL editor, start task 4 |
| 2:00 | `auth/requireUser.ts`, `db/client.ts`, `queue/memoryQueue.ts`, `security/{crypto,oauthState}.ts` | bearer auth on your routes, token encryption, OAuth state, `queue.add` from the webhook |
| 2:10 | `engine/index.ts` `getEngine()` returning a stub (`analyze` = fixture, `draftReply` = canned) | build the reply flow without waiting for the real engine |
| 3:30 | worker skeleton that calls `getDelivery().sendReel(...)` with `render_mode: 'text_only'` | your `TelegramDelivery` text-card path is exercised at M2 |
| 6:55 | real MP4 artifacts | `sendVideo` path |

Code against the interfaces in `packages/shared/src/interfaces.ts` (`DeliveryConnector`, `SourceConnector`, `ComprehensionEngine`); never import A's concrete classes.

## Your schedule (2-developer plan)

| Time | Task (PLAN.md #) | Output | Checkpoint |
| --- | --- | --- | --- |
| 0:00–0:40 | 0 accounts: Supabase project; Slack app (user scopes `im:history im:read users:read chat:write`, user event `message.im`, redirect `${API_BASE_URL}/api/integrations/slack/callback`); BotFather bot; ngrok reserved domain | keys in a shared `.env` (not committed) | – |
| 0:40–1:10 | workspace prep: professor + student Slack accounts in the team workspace, phone with Telegram, demo message saved; read `PLAN.md` §4.3, §4.5, §10 | – | – |
| 1:10–1:30 | pull skeleton; run migration in Supabase; create private bucket `reels`; `pnpm dev` works | – | **M0** |
| 1:30–2:40 | 4 Slack: `connectors/slack/{verify,normalize,oauth}.ts`, `routes/api/slack.ts` (start returns `{ url }` with signed state; callback verifies state, exchanges code, upserts `connections`), `routes/webhooks/slack.ts` (raw body, verify, ack, filter to tracked person, idempotent insert, `queue.add`). Wire `requireUser`/`crypto`/`oauthState` when A pushes them at 2:00. | real DM → `messages` row + `processing_jobs(queued)` | **Hour-1 decision (by 2:45):** no event within 15 min of correct setup → bot mode per §10 (replies then post as the bot with `On behalf of <student>:`) |
| 2:40–3:25 | 6 Telegram: `bot.ts` (Telegraf polling), pairing `/start <code>`, `routes/api/telegram.ts`, `telegram_sessions`, ownership-check helper (§10) | `/start` pairs; foreign callback → "Not available" | – |
| 3:25–4:00 | 12a `TelegramDelivery` text-card path + keyboard + `Original` / `Actions` / `Got it` handlers; `delivery/index.ts` returns it | text card with buttons arrives | **M2 at 4:00:** real DM → A's worker → your text card → `Original` and `Actions` work |
| 4:00–4:30 | 5 entities: `routes/api/entities.ts` (`users.list`, humans only), `PUT /api/tracked-entities` | professor selectable via API | – |
| 4:30–5:30 | 13 reply flow: `Reply` sets `awaiting_reply`; text → `getEngine().draftReply` → `reply_drafts(draft)` → show original + English + meaning check + `[Send][Regenerate][Cancel]`; **atomic approve** `UPDATE … WHERE status='draft' RETURNING` | double `Send` tap → one send | – |
| 5:30–6:10 | 14 `SlackConnector.sendReply` (user token, `thread_ts` = parent `ts`), `POST /api/replies/:id/approve`, `send_uncertain` reconcile via `conversations.replies` | threaded reply appears as the student | **M3 (~7:30 once A's video lands):** full DoD once |
| 6:10–6:35 | 12b `sendVideo` with bytes, caption, `⚠️ demo-injected` marker when `is_mock` | video plays inline | – |
| 6:35–7:50 | 16 web: Supabase magic-link login, `lib/api.ts` bearer client, Setup page (Slack card → `start` URL, Telegram card → pairing code + deep link, sender picker, language select) | setup in ≤ 5 clicks | – |
| 7:50–8:50 | 17 web: History list + detail (poll 3 s while non-terminal, signed video URL, original, actions, drafts, retry button, MOCK badge) | history usable in the pitch | – |
| 8:50–9:30 | 20 hardening (your side): bot restart with old buttons, double-tap approve, revoked token → Reconnect, Slack send failure → `Retry send` | each observed | **M4 at 9:00 with A:** DoD twice |
| 9:30–10:10 | 22 record `demo/backup.mp4` from a real run (screen + phone) | file in `demo/` (A-owned folder: hand the file to A to commit, or use Git LFS-free size ≤ 50 MB) | – |
| 10:10–10:30 | polish: copy, labels ("AI-assisted"), Tier B review with A | – | – |
| 10:30–12:00 | 24 rehearsal ×2 with A; pre-send message 1 three minutes before the slot | – | – |

Until the Setup page exists (6:35), select the tracked sender with `curl` against `PUT /api/tracked-entities` or a direct SQL insert; do not block M2 on the web UI.

## Integration checkpoints with A

- **1:10** pull skeleton; tell A if `pnpm dev` fails.
- **2:00** wire `requireUser`, `crypto`, `oauthState`, `queue`.
- **2:10** start reply flow against `StubEngine`.
- **4:00 M2** send a real DM from the professor account; confirm the text card and buttons.
- **6:55** first video; report `sendVideo` errors (size) to A.
- **7:30 M3**, **9:00 M4**.

## While blocked on A

Write `verify.test.ts` and `oauthState.test.ts` from §4.3 (pure functions, no server); build the Telegram keyboard layouts; draft the web pages against `packages/shared/src/api.ts` types; prepare the Slack workspace, the professor's saved message, and the phone.

## Git rules (both developers)

1. Work directly on `main`. Commit every 20–30 minutes with a message that names the task number, e.g. `B#4: slack oauth + events webhook`.
2. Before every push: `git pull --rebase origin main && pnpm install --frozen-lockfile || pnpm install`, run `pnpm -r typecheck`, then `git push`.
3. Only edit paths you own. If you need a change in the other developer's file, send the exact snippet in chat; they apply it.
4. `pnpm-lock.yaml`: add deps with `pnpm add …` and push within 5 minutes. If it conflicts on rebase, run `git checkout --theirs pnpm-lock.yaml && pnpm install` and commit.
5. `packages/shared`: you only append to `api.ts`; anything else goes through A.
6. Never commit `.env`; `.gitignore` already excludes it.
