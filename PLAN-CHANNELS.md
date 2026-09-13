# PLAN-CHANNELS — multi-channel delivery (Instagram focus)

Owner: **Dev B**. Extends `PLAN-DEV-B.md`. Goal: the web app shows several connectable accounts, the user
picks **which channel receives their reels**, and Instagram DM works end-to-end as a reel-delivery bot.

Everything here is additive to the existing `SourceConnector` / `DeliveryConnector` split in
`packages/shared/src/interfaces.ts`. No existing Slack or Telegram behaviour changes.

---

## 0. The two facts that shape the whole design

**(a) Instagram's 24-hour messaging window.** Meta only lets us DM a user within 24h of *their* last message
to us. ReelRelay is proactive ("a Slack message landed → push a reel"), so this is a real architectural
constraint, not a detail.

The escape hatch: **a quick-reply tap is an inbound user message and resets the window.** Every reel we send
carries the 📄 / ✅ / ✍️ / 👍 buttons already specified in `delivery/telegram/bot.ts` COPY. An engaged user
therefore keeps their own window open just by using the product. We only fall out of the window when a user
goes >24h without touching a reel — and that case degrades to another channel (§4).

**(b) Composio cannot do Instagram delivery.** Its toolkit is `Triggers: 0`, `Send Image` / `Send Text Message`
only — no video, no buttons, no webhooks. Meta's own API supports all three. **We go direct to Meta.**
(Composio stays an option later for *source* connectors like Notion/Linear, where actions are RPC-shaped.)

---

## 1. Phase 0 — make the delivery layer plural (prerequisite)

Today `getDelivery()` in `apps/server/src/delivery/index.ts:23` is a process-wide singleton hard-wired to
Telegram. Nothing multi-channel is possible until that changes.

### 1.1 Capability descriptor — new, in `packages/shared/src/interfaces.ts`

```ts
export interface ChannelCapabilities {
  video: "bytes" | "url" | false;   // how (or whether) an MP4 can be sent
  buttons: "inline" | "quick_reply" | "link" | false;
  maxVideoBytes: number | null;
  messagingWindowMs: number | null; // null = no window (Telegram, email)
}
export interface DeliveryConnector {
  readonly provider: DeliveryProvider;
  readonly capabilities: ChannelCapabilities;
  pair(userId: string, pairingCode: string): Promise<void>;
  sendReel(deliveryTargetId: string, artifact: ReelArtifact): Promise<string>;
  sendDraft(deliveryTargetId: string, draft: ReplyDraft): Promise<string>;
}
```

The worker then picks a render mode the channel can actually carry, instead of assuming Telegram's abilities.

### 1.2 Registry — replaces the singleton

```ts
// apps/server/src/delivery/index.ts
export function getDeliveryFor(provider: DeliveryProvider): DeliveryConnector;
export async function getDeliveryForUser(userId: string): Promise<{
  connector: DeliveryConnector; targetId: string;
} | null>;   // reads users.preferred_delivery_provider, falls back to newest active connection
```

Keep the existing `getDelivery()` export as a thin alias to the Telegram connector so Dev A's worker keeps
compiling during the transition; swap the call site in `worker/generateReel.ts:155` in the same PR.

### 1.3 Schema — **Dev A-owned files, needs coordination**

New migration `supabase/migrations/0002_channels.sql`:

```sql
alter table public.connections drop constraint connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('slack','telegram','mock','instagram','gmail','discord'));

-- 24h-window bookkeeping; null for channels without a window
alter table public.connections add column last_inbound_at timestamptz;
alter table public.connections add column display_label text;

alter table public.users add column preferred_delivery_provider text
  check (preferred_delivery_provider in ('telegram','instagram','gmail','discord'));
```

Also widen in `packages/shared/src/messages.ts:6`: `provider: z.enum(["slack","mock"])` →
add `"instagram"`, `"gmail"`. **Flag to Dev A before touching** — `packages/shared` and the migration are
A-owned per `DEV-B-HANDOFF.md` §1.

### 1.4 Generalize the connection upsert

`db/queries/connections.ts:29` `upsertSlackConnection` is provider-specific. Add a generic
`upsertConnection({ userId, provider, externalAccountId, ... })` and reimplement the Slack one on top of it,
so Slack's call sites and tests are untouched.

---

## 2. Phase 1 — Instagram delivery (the focus)

### 2.1 Prerequisites (do first; they have lead time)

| Item | Notes |
|---|---|
| Instagram **professional** account (Business or Creator) | personal accounts cannot use the API at all |
| Meta app with **Instagram** product added | use *Instagram API with Instagram Login* — no Facebook Page needed |
| Permission `instagram_business_manage_messages` | **Development Mode is enough for the demo** — works for any account with a role on the app. Production needs App Review + Business Verification. |
| Webhook subscription on the `messages` field | callback URL `${API_BASE_URL}/webhooks/instagram` |
| `IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `IG_CLIENT_ID`, `IG_CLIENT_SECRET`, `IG_REDIRECT_URI` in `.env` | document in `CLAUDE.md` |

Add every IG tester account under App Roles before the demo, or sends will silently fail.

### 2.2 Files to create

```
apps/server/src/connectors/instagram/
  oauth.ts        authorize URL + code exchange (mirror connectors/slack/oauth.ts)
  verify.ts       X-Hub-Signature-256 HMAC — same shape as connectors/slack/verify.ts
  normalize.ts    IG webhook envelope → inbound event (message | postback)
apps/server/src/delivery/instagram/
  InstagramDelivery.ts   implements DeliveryConnector
  quickReplies.ts        the 4-button set (parallels delivery/telegram/keyboards.ts)
  window.ts              24h-window read/write against connections.last_inbound_at
apps/server/src/routes/webhooks/instagram.ts
apps/server/src/routes/api/instagram.ts     OAuth start + callback
```

### 2.3 Sending a reel — the mechanism

Telegram uploads **bytes** (`Input.fromBuffer`, `TelegramDelivery.ts:321`). Instagram instead takes a
**public HTTPS URL that Meta fetches server-side**. We already have exactly the right helper:

```ts
// render/upload.ts — already exists, 1-hour TTL signed URL over the private `reels` bucket
const url = await signedArtifactUrl(artifact.videoPath);

POST https://graph.instagram.com/v21.0/<IG_ID>/messages
{ "recipient": { "id": igScopedUserId },
  "message": { "attachment": { "type": "video", "payload": { "url": url } } } }
```

Then a second call carrying the caption text + quick replies, because IG will not attach buttons to a media
message. So one reel = **2 API calls**, not 1.

> Verify the DM attachment size cap (~25 MB) against a real render before demo day. If a reel exceeds it,
> degrade to `captions_only`; the capability descriptor's `maxVideoBytes` is what the worker checks.

### 2.4 Buttons

Quick replies (max 13, text-only labels) map cleanly onto the existing four actions:

| Telegram inline button | IG quick reply payload |
|---|---|
| 📄 Original | `orig:<messageId>` |
| ✅ Actions | `acts:<messageId>` |
| ✍️ Reply | `reply:<messageId>` |
| 👍 Got it | `ack:<messageId>` |

The payload format is deliberately identical to the Telegram callback data so `delivery/telegram/reply.ts`'s
flow logic can be lifted into a shared handler rather than duplicated.

### 2.5 The window guard — the part that must not be skipped

```ts
// delivery/instagram/window.ts
export async function windowOpen(connectionId: string): Promise<boolean>;   // last_inbound_at > now - 24h
```

- **Webhook** writes `last_inbound_at = now()` on *every* inbound event, message or postback.
- `sendReel` checks `windowOpen()` **before** calling Meta and throws a typed
  `InstagramWindowClosed` error if shut — we do not spend an API call to be rejected.
- `worker/generateReel.ts:154` currently retries delivery unconditionally on `[1s, 3s, 9s]`. That is correct
  for Telegram but wrong here: a closed window and a quota rejection are both stable for hours. **Classify
  the error and fail fast**, the way `SlackConnector` already separates `api_error` from `network`:

| Meta error | Meaning | Action |
|---|---|---|
| code 10 / subcode 2534022 | outside 24h window | no retry → fall back (§4) |
| code 9 / subcode 2207042 | publishing quota | no retry → fall back |
| 5xx / timeout | transient | keep the existing 3-step ladder |

### 2.6 Pairing

Same ritual as Telegram's `/start <code>`: the Setup page shows a code and an `ig.me/m/<username>` deep link;
the user DMs the code; the webhook matches it, writes the connection row with the IG-scoped user id as
`external_account_id`, and stamps `last_inbound_at`. Pairing therefore *opens* the window as a side effect,
which is why the first reel always lands during a demo.

---

## 3. Phase 2 — Gmail delivery (the channel with no window)

Worth building precisely because it has **no messaging window and no app review**, so it is the honest
fallback under every Instagram rejection.

- Google OAuth (`gmail.send`), tokens encrypted via the existing `security/crypto.ts`.
- **Token refresh is new work** — Slack user tokens never expire, so we have no refresh path today. Gmail's
  expire hourly. Add `refresh_token` handling in `connectors/gmail/oauth.ts`.
- `sendReel` → MIME mail with the signed video URL as a thumbnail link (not an attachment; keeps us under
  Gmail's 25 MB and avoids slow sends).
- Buttons → four signed links back into the web app (`/r/<messageId>?a=orig&sig=…`), reusing the HMAC
  construction in `security/oauthState.ts`. This needs a small `apps/web/app/r/[messageId]/page.tsx`.

Capabilities: `{ video: "url", buttons: "link", messagingWindowMs: null }`.

---

## 4. Phase 3 — the degradation ladder

One ordered policy, evaluated per delivery in the worker:

1. User's `preferred_delivery_provider`, if its window is open and it can carry the artifact.
2. Any other active connection that can.
3. Same channel, degraded `render_mode` (`remotion` → `captions_only` → `text_only`).
4. Mark the job `failed` with `error_code = 'DELIVERY'` and surface it in the web app history.

A closed Instagram window is therefore a *routing* event, not an error the user sees — the reel arrives on
Telegram or by email with a one-line "Instagram is asleep, tap here to wake it" deep link.

---

## 5. Phase 4 — the web app channel picker

`IntegrationsResponse` (`packages/shared/src/api.ts:107`) is `{ slack, telegram }` — fixed keys, which cannot
express N channels. Change to a list:

```ts
export interface ChannelState {
  provider: DeliveryProvider; connected: boolean; connectionId: string | null;
  label: string | null; status: ConnectionStatus;
  capabilities: ChannelCapabilities;
  windowOpen: boolean | null;      // instagram only; null elsewhere
}
export interface IntegrationsResponse {
  sources: SourceChannelState[];
  delivery: ChannelState[];
  preferredDeliveryProvider: DeliveryProvider | null;
}
```

Keep `slack` / `telegram` on the response as deprecated aliases for one commit so the existing Setup page
does not break mid-refactor.

New route: `PUT /api/preferences/delivery { provider }`.

**Setup page** (`apps/web/app/setup/`): a card grid, one per channel — Connect / Disconnect, a "deliver here"
radio, and honest capability badges (`Video · Buttons`, `Link buttons`, `Asleep — tap to wake`). That grid
*is* the "fully compatible with different accounts" story, and it stays truthful because the badges are
rendered from `capabilities`, not hardcoded.

---

## 6. Build order and effort

| # | Step | Effort | Blocks |
|---|---|---|---|
| 1 | Meta app + IG test account + webhook verified | 1–2 h | everything IG |
| 2 | Phase 0 registry + capabilities + migration | 3 h | all channels |
| 3 | IG OAuth + pairing + webhook | 3 h | 1, 2 |
| 4 | `InstagramDelivery.sendReel` + quick replies | 3 h | 3 |
| 5 | Window guard + error classification | 2 h | 4 |
| 6 | Setup page channel grid | 3 h | 2 |
| 7 | Gmail delivery | 4 h | 2 |
| 8 | Degradation ladder | 2 h | 5, 7 |

**Suggested demo cut:** steps 1–6. That delivers a real Instagram reel bot plus a Setup page that already
lists Gmail and Discord as connectable, which tells the multi-channel story without three app reviews.

If a fourth channel is wanted for the grid, add **Discord** rather than WhatsApp or Messenger: bot token
only, no OAuth, no app review, native video upload *and* real buttons, no messaging window. It is the only
remaining channel that costs hours instead of days.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| IG App Review not granted by demo day | Development Mode + tester roles; never demo from an unlisted account |
| 24h window shut during the demo | pairing opens it; do the pairing step live, on camera |
| Signed URL expires before Meta fetches | 1 h TTL is ample, but generate it *inside* `sendReel`, never earlier |
| Video exceeds the DM attachment cap | `maxVideoBytes` check → `captions_only` degrade |
| Dev A's shared types diverge | §1.3 touches A-owned files — agree the enum values before writing code |
