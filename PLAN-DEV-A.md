# PLAN-DEV-A — Pipeline + Reel (engine, TTS, render, worker, Remotion)

Read `PLAN.md` first; it holds every contract (schema §7, Zod §8, prompts §11, reel spec §12, failure table §15). This file only says **what Dev A builds, in what order, and which files Dev A owns**. Dev B's file is `PLAN-DEV-B.md`. The two are designed so that you never edit the same file.

## Ownership (you may create and edit only these paths)

| Path | Notes |
| --- | --- |
| root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.env.example`, `pnpm-lock.yaml` | You create these in the skeleton commit. After that, `pnpm-lock.yaml` changes only via `pnpm add` and are committed immediately (see git rules). |
| `packages/shared/**` | You own it. B may **append** new exports to `packages/shared/src/api.ts` only. Any change to an existing schema is announced in chat before pushing. |
| `packages/reel/**` | Remotion project. |
| `supabase/migrations/0001_init.sql` | Copy §7 verbatim in the skeleton commit. Schema changes after that: announce, then edit, then B applies in Supabase. |
| `apps/server/src/index.ts`, `config.ts` | Created in skeleton with the extension points below. `config.ts` lists **every** env var from §6 up front so B never needs to edit it. |
| `apps/server/src/queue/**`, `worker/**`, `engine/**`, `tts/**`, `render/**`, `connectors/mock/**` | Pipeline. |
| `apps/server/src/db/client.ts`, `db/queries/{messages,jobs,artifacts}.ts` | Your queries. B owns the other query files. |
| `apps/server/src/security/{crypto,oauthState}.ts`, `auth/requireUser.ts` | Small; you write them in task 3 because B needs them at 2:00. |
| `apps/server/src/routes/api/{messages,demo}.ts` | History endpoints and the injector. |
| `apps/server/test/{faithfulness,timing,crypto,jobs,authz-messages}.test.ts` | Your tests. |
| `fixtures/**`, `scripts/**`, `demo/` | Fixtures, latency script, backup video folder. |

**Never touch:** `apps/web/**`, `apps/server/src/routes/webhooks/**`, `routes/api/{integrations,slack,entities,telegram,replies,preferences}.ts`, `connectors/slack/**`, `delivery/**`, `db/queries/{connections,entities,drafts,telegram,preferences}.ts`.

## Extension points you create in the skeleton (so B never edits your files)

```ts
// apps/server/src/index.ts  (A-owned; B never edits)
import { registerApiRoutes } from "./routes/api/index.js";        // B-owned file, you create an empty stub
import { registerWebhooks } from "./routes/webhooks/index.js";     // B-owned, stub
import { startTelegramBot } from "./delivery/telegram/bot.js";     // B-owned, stub that logs "telegram: not wired"
import { getDelivery } from "./delivery/index.js";                 // B-owned, stub returns ConsoleDelivery
import { startWorker } from "./worker/index.js";                   // A-owned
```

`apps/server/src/delivery/index.ts` stub (B replaces later): exports `getDelivery(): DeliveryConnector` returning a `ConsoleDelivery` that logs the artifact. Your worker only ever calls `getDelivery()`, so B's real Telegram delivery drops in without touching your code.

`apps/server/src/engine/index.ts` (A-owned): exports `getEngine(): ComprehensionEngine`. Until task 8 is done it returns `StubEngine`, whose `analyze` returns `fixtures/expected/professor_deadline.interpretation.json` and whose `draftReply` returns a canned English draft. B codes the reply flow against this stub from 2:10.

## Skeleton commit checklist (push by 1:10, this unblocks B)

- [ ] `pnpm init` monorepo, `apps/web` via `create-next-app --ts --tailwind --app --yes`, `apps/server` (Fastify 5, `tsx`), `packages/shared`, `packages/reel` (`npx create-video@latest --blank --yes`, then move).
- [ ] Install **all** known deps now so the lockfile stays stable: server: `fastify @fastify/raw-body @supabase/supabase-js zod @anthropic-ai/sdk @slack/web-api telegraf @remotion/renderer @remotion/bundler remotion react react-dom`; dev: `vitest tsx typescript @types/node`; web: `@supabase/supabase-js @supabase/ssr`.
- [ ] `packages/shared/src/*` exactly per §8 + §4.2.
- [ ] `supabase/migrations/0001_init.sql` exactly per §7.
- [ ] `apps/server/src/config.ts` with every §6 var (zod, optional where the fallback allows).
- [ ] `apps/server/src/index.ts` with the extension points above and stub files for B's paths.
- [ ] `.env.example` per §6. Commit message: `Skeleton: monorepo, shared contracts, migration, server boot points`.

## Your schedule (2-developer plan)

| Time | Task (PLAN.md #) | Output | Handoff to B |
| --- | --- | --- | --- |
| 0:00–1:10 | 1 skeleton, 2 contracts | pushed skeleton | B pulls, applies migration, starts task 4 |
| 1:10–2:00 | 3 server boot: `db/client.ts`, `requireUser.ts`, `crypto.ts`, `oauthState.ts`, `queue/memoryQueue.ts`, `/health` | `GET /health` 200; bearer → userId | B wires OAuth + webhook onto these at 2:00 |
| 2:00–2:10 | `StubEngine` (fixture `analyze`, canned `draftReply`) | pushed | B starts reply flow against the stub |
| 2:10–3:30 | 8 engine: prompts, `messages.parse` with `effort: "medium"`, `max_tokens: 8192`, Tier A checks, six fixtures | professor fixture passes A1–A5; latency of 3 runs logged | – |
| 3:30–4:00 | 11a worker skeleton: `queued → analyzing → delivering(text_only) → complete`, `stage_timings` | job runs end to end with a text card | **M2 at 4:00:** real DM (B) → your worker → B's text card in Telegram |
| 4:00–4:40 | 9 TTS + timing + `captions_only` fallback | mp3 + `captionSegments` from alignment | – |
| 4:40–6:10 | 7 Remotion `Reel`: chip, hook (silent 1.2–3.5 s), captions from 3.5 s, paged action card (3/page, all items), outro, Noto fonts | `remotion preview` correct with 4 actions on 2 pages | – |
| 6:10–6:55 | 10 `RemotionRenderer` (`bundle` at boot, `timeoutInMilliseconds: 150000`), upload, signed URL | MP4 ≤ 20 MB in ≤ 60 s | B's `sendVideo` path receives `videoPath` |
| 6:55–7:20 | 11b worker full: voicing, rendering, fallbacks (§15), retry-from-stage | first real reel in Telegram | **M3 (~7:30 with B's approve):** full DoD once |
| 7:20–7:45 | 15 injector `POST /api/demo/inject` + `scripts/inject-demo.ts` + `is_mock` | injector produces a reel | – |
| 7:45–8:05 | 18 `scripts/smoke-e2e.ts`: 3 runs, per-stage ms | numbers for the pitch card | – |
| 8:05–8:50 | 19 your tests: faithfulness A1–A5 incl. `晚上11:59`, timing, crypto, one-job-per-message, foreign message → 404 | green | – |
| 8:50–9:30 | 20 hardening (your side): kill TTS key, force Remotion error, narration > 40 s regeneration | each fallback observed | – |
| 9:30–10:30 | Tier A tuning pass on six fixtures, Tier B human review with B, pitch card (task 23) | card done | – |
| 10:30–12:00 | 24 rehearsal ×2 with B | – | – |

If task 8 latency is > 12 s on 3 runs, switch `effort` to `"low"` immediately (PLAN.md §15).

## Integration checkpoints with B

- **1:10** skeleton pushed. Message B: "pull, apply migration, env is in `config.ts`".
- **2:00** `requireUser`, `db/client`, `queue` pushed. B's webhook can call `queue.add`.
- **2:10** `StubEngine` pushed.
- **4:00 M2** B sends a real DM; you watch `processing_jobs` go `queued → complete`; B confirms the text card and buttons.
- **6:55** first real video; if `sendVideo` fails on size, tell B and re-render with `crf: 30`.
- **7:30 M3**, **9:00 M4** per PLAN.md §17.

## While blocked on B

Write fixtures 2–6 and `fixtures/expected/*.json`; run Tier A against them; tune Remotion caption sizing with long CJK strings; write the `smoke-e2e.ts` runner against the injector so it does not need Slack.

## Git rules (both developers)

1. Work directly on `main`. Commit every 20–30 minutes with a message that names the task number, e.g. `A#8: engine prompts + Tier A checks`.
2. Before every push: `git pull --rebase origin main && pnpm install --frozen-lockfile || pnpm install`, run `pnpm -r typecheck`, then `git push`.
3. Only edit paths you own. If you need a change in the other developer's file, send the exact snippet in chat; they apply it.
4. `pnpm-lock.yaml`: add deps with `pnpm add …` and push within 5 minutes. If it conflicts on rebase, run `git checkout --theirs pnpm-lock.yaml && pnpm install` and commit.
5. `packages/shared`: additive changes only after the skeleton; announce edits to existing schemas before pushing.
6. Never commit `.env`; `.gitignore` already excludes it.
