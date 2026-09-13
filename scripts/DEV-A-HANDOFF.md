# Dev A handoff

Install with `pnpm install --frozen-lockfile`. Copy `.env.example` to `.env`; set the service keys locally. Run `pnpm dev`.

Dev B can replace the scaffold files at `routes/api/index.ts`, `routes/webhooks/index.ts`, `delivery/index.ts`, and `delivery/telegram/bot.ts`. Retain the calls to `registerMessageRoutes(app)` and `registerDemoRoutes(app)` in API registration.

- `db/client.ts`: `getDb()`, lazy `db` and `supabase` exports.
- `auth/requireUser.ts`: `await requireUser(request)` returns the user ID and sets `request.userId`; also usable as a preHandler.
- `security/crypto.ts`: `encrypt(text)`, `decrypt(text)`.
- `security/oauthState.ts`: `createOAuthState(userId)`, `verifyOAuthState(state)` returning `{userId, nonce, exp}`.
- `queue/memoryQueue.ts`: `queue.add('generate_reel', {messageId})`; jobs serialize and duplicate queued/running IDs coalesce.
- `db/queries/messages.ts`: `persistMessage(userId, normalizedMessage)` returns `{message, inserted}`; call `ensureJob(message.id)` from `db/queries/jobs.ts` before queueing. Repair a missing job even if the message already exists.
- `engine/index.ts`: `getEngine()` implements the shared interface. Live is the default. `ENGINE_MODE=stub` is an explicit fixture-only development option; `PIPELINE_MODE=text` skips video generation.
- `ReelArtifact` paths are LOCAL files for Telegram streaming; database paths are storage keys. `error`, when present, must be displayed as a notice. For translation errors show `originalText` and do not label it a translation.
- `ConversationContext` contains `message`, `interpretation`, `preferences`, and optional `studentName`/`previousThreadMessages`.
- The server registers `fastify-raw-body` globally with `global:false`; opt Slack's route in using `config: {rawBody:true}`.

Current scaffold: Slack/Telegram and web flows belong to Dev B. History and demo routes are still being completed by Dev A. The worker and renderer are implemented; live integration and video rendering still need verification. Typechecking passed before this handoff.
