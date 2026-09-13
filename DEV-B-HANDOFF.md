# Dev B handoff — connectors + web (Slack, Telegram, reply flow, web app)

Built on top of Dev A's skeleton (`5f655da`). Every file lives in the paths `PLAN-DEV-B.md` assigns to Dev B; nothing Dev A owns
was edited, except that `packages/shared/src/api.ts` gained an appended, clearly marked Dev B section.

## What is implemented

| Area | Files | Behavior |
| --- | --- | --- |
| Slack OAuth | `connectors/slack/oauth.ts`, `routes/api/slack.ts` | `GET /api/integrations/slack/start` (bearer, optional `?mode=bot_token`) → `{ url }` with `createOAuthState`; `GET /api/integrations/slack/callback` verifies the state, exchanges the code, encrypts the token, upserts `connections`, 302 → `${APP_BASE_URL}/setup?slack=ok` (or `?slack=error&reason=`). |
| Slack events | `routes/webhooks/slack.ts`, `connectors/slack/{verify,filter,normalize}.ts` | `POST /webhooks/slack/events`: raw-body HMAC + 300 s window (401), `url_verification` echo, 200 `{}` ack then async: filter (bot/subtype/non-im dropped), connection by team + authed user, tracked sender check, `persistMessage` + `ensureJob` + `queue.add`. Duplicate deliveries repair a missing job but never re-run a finished one. |
| Slack reply | `connectors/slack/SlackConnector.ts` | `sendReply` posts as the student with `thread_ts` = parent ts, retries disabled (never double-posts); errors classified `api_error` → draft `failed`, `network` → `send_uncertain` + `reconcileUncertainSend` (conversations.replies). Revoked tokens flip `connections.status='error'`. Bot mode prefixes `On behalf of <student>:`. |
| Telegram | `delivery/telegram/*`, `delivery/index.ts`, `routes/api/telegram.ts` | `getDelivery()` → `TelegramDelivery` when `TELEGRAM_BOT_TOKEN` is set (console fallback otherwise). Pairing `/start <code>` (one-time, 10 min). Buttons `📄 Original / ✅ Actions / ✍️ Reply / 👍 Got it`; callback data `<kind>:<id8>`; every callback passes the ownership check (chat → session user → row). Works across bot restarts (all state in DB). |
| Reply flow | `delivery/telegram/reply.ts`, `db/queries/drafts.ts`, `routes/api/replies.ts` | Reply → `awaiting_reply` → text → `getEngine().draftReply` → `reply_drafts(draft)` → card with `[📤 Send][🔁 Regenerate][❌ Cancel]`. Approve is ONE conditional `UPDATE … WHERE status='draft'` (double tap → one send, `409 already_handled`). `POST /api/replies/:id/{approve,regenerate,retry-send}`. |
| API | `routes/api/{index,integrations,entities,preferences}.ts` | `registerApiRoutes(app)` registers B's routes plus A's `registerMessageRoutes` / `registerDemoRoutes`; scoped error handler → `{ error: { code, message } }`. `GET /api/integrations`, `DELETE /api/integrations/:id`, `GET /api/integrations/:id/entities` (humans only), `PUT|GET /api/tracked-entities`, `GET|PATCH /api/preferences`, `POST /api/telegram/pairing-code`. |
| Web | `apps/web/**` | Magic-link login, `/setup` (Slack card with Reconnect + bot-mode link, Telegram pairing card with deep link + polling, sender picker, language/tone), `/history` (3 s polling, status chips, MOCK badge), `/history/[id]` (job timings, video player, original, actions, drafts with approve/retry/regenerate, job retry). All API calls go through `app/api/proxy/[...path]` (server-side forward with the bearer). |
| Tests | `apps/server/test/{verify,oauthState,filter,normalize,approval,ownership}.test.ts` | 70 tests; with Dev A's 27 the suite is 97/97. |

## Contracts Dev A should know

- **Worker → delivery:** `getDelivery().sendReel(chatId, artifact)` is a single attempt (the worker's 4× retry is the only retry). `artifact.videoPath` is read from disk; if the file is gone it falls back to the Storage key in `reel_artifacts.video_path`; > 50 MB sends a 1-hour signed link. `renderMode: "text_only"` or `artifact.error` → text card. **Error semantics:** `error.code` starting with `LLM_` (or a placeholder interpretation with `sourceLanguage: "und"`) shows the verbatim original under a ⚠️ notice and never calls it a translation; any other `error` (RENDER, NARRATION_TOO_LONG, …) shows the ⚠️ notice **plus** the full card (hook, narration, every action), per PLAN.md §15.
- **`packages/shared/src/api.ts`:** Dev B's section (below the banner) adds `ReplyDraftRecord` (ReplyDraft + `createdAt`), `MessageDetailResponse` (mirrors your `GET /api/messages/:id` exactly), the `RETRY_UNAVAILABLE` note, and every Dev B endpoint type. If you change a history response, update `MessageDetailResponse` in that section too (the web reads it).
- **Error codes:** yours are UPPERCASE (`NOT_FOUND`, `UNAUTHORIZED`), Dev B's are lowercase (`not_found`, `already_handled`). The web only special-cases `already_handled`; everything else is shown by message.
- **Slack webhook** opts into your `fastify-raw-body` registration with `config: { rawBody: true }`.
- Unset `SLACK_SIGNING_SECRET` → every webhook delivery is rejected 401 (fails closed). Unset `TELEGRAM_BOT_TOKEN` → `telegram: not started (no token)` and the console delivery is used.

## Running it (both developers)

1. Root `.env` from `.env.example`; also `SLACK_BOT_SCOPES` is optional (bot-mode fallback, default `channels:history,channels:read,chat:write,users:read`). The web app loads the root `.env` from `next.config.ts`; the server loads it from `config.ts`.
2. Supabase: run `supabase/migrations/0001_init.sql`, create the private bucket `reels`, add `${APP_BASE_URL}/auth/callback` to Auth → URL configuration (redirect allow-list).
3. Slack app: user scopes `im:history im:read users:read chat:write`, user event `message.im`, Request URL `${API_BASE_URL}/webhooks/slack/events`, redirect `${API_BASE_URL}/api/integrations/slack/callback` (ngrok must be up before saving).
4. `pnpm install --frozen-lockfile && pnpm dev` → web :3000, server :4000. Log line `telegram: polling as @…` confirms the bot.
5. Setup page: Connect Slack → Get pairing code → Open Telegram → pick the professor → (language stays zh-CN). Then DM from the professor account.

## Known gaps / next checks (Dev B)

- No live Slack/Telegram call has been exercised yet (no keys in this checkout): first real run = hour-1 decision point (do user-scope `message.im` events arrive?). Bot mode is wired (`?mode=bot_token`, channel tracking) as the fallback.
- Webhook persist path (`persistMessage`/`ensureJob`) has no integration test; unit tests cover the pure functions and the approval gate.
- Disconnect button on the Slack card is present (stretch in PLAN); remove from `SlackCard.tsx` if unwanted on the judged screen.
