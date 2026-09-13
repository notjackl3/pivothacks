# PLAN-PIVOT-03 — Context-aware delivery (Team 10 · Communication Breakdown)

Extends `PLAN.md`, `PLAN-DEV-A.md`, `PLAN-DEV-B.md`. Nothing here changes the core product
(Slack → translated reel → Telegram → approved reply). It adds **one decision point** to the pipeline so
that the student's situation changes *how, when and in what form* a message reaches them.

## 0. Why we do not pass the brief today

The pivot says: context must change a core output, recommendation, ranking, decision or workflow.
*Displaying* context, changing copy, or adding a filter does not count.

| Context we already compute | Where it lives | What it changes today |
| --- | --- | --- |
| `urgency` (low / medium / high) | `MessageInterpretationSchema`, set by Claude | A chip on the reel, one word in the Telegram caption, a column in History. **Nothing else.** |
| `dueAt` per action item | `ActionItemSchema` | Shown on the action card. No ranking, no reminder. |
| Relationship to sender | Only `preferences.reply_tone`, chosen by the user once | Reply drafts only. The reel and the interpretation do not know who the sender is. |
| Time / timezone | `preferences.timezone` | Resolves "Friday 5 PM" to an ISO time. Delivery never looks at the clock. |
| Channel | Hard-wired to Telegram in `delivery/index.ts` | – |

Every signal exists in the data model. None of them branches the workflow. Judges would call this
"displaying the context".

## 1. What we build: the Triage Router

After the `analyzing` stage, one pure function decides the delivery plan for the message:

```ts
// packages/shared/src/delivery.ts   (Dev A)
export const DeliveryModeSchema = z.enum(["instant", "reel", "digest"]);
export const DeliveryPlanSchema = z.object({
  mode: DeliveryModeSchema,
  deliverAfter: z.string().nullable(),   // ISO; null = now
  reasons: z.array(z.string()).min(1).max(4), // machine codes, e.g. "urgency_high", "deadline_within_24h", "quiet_hours"
  reasonText: z.string().max(120),       // one human line in the student's language, shown in Telegram + History
  replyTone: ReplyToneSchema,            // tone the draft will use unless the student overrides
});
```

```ts
// apps/server/src/worker/decideDelivery.ts   (Dev A, pure, no I/O)
export function decideDelivery(input: {
  interpretation: MessageInterpretation;
  relationship: SenderRelationship;      // from tracked_entities
  prefs: UserPreferences;                // timezone, quietHours, replyTone
  now: Date;
}): DeliveryPlan
```

### 1.1 Inputs (the situational context)

| Context | Source | Type |
| --- | --- | --- |
| Urgency | `interpretation.urgency` | `low \| medium \| high` |
| Hours until nearest essential deadline | min over `actionItems` where `essential && dueAt` | number or null |
| Local time of day | `now` in `prefs.timezone` | HH:mm |
| Quiet hours | `preferences.quiet_start` / `quiet_end` (default 22:00–08:00) | two `HH:mm` |
| Sender relationship | `tracked_entities.relationship` | `professor \| employer \| landlord \| peer \| other` |
| Sensitive topic | `interpretation.isSensitive` | boolean |

### 1.2 Rules (deterministic, table-tested)

Evaluate top to bottom; first match wins for `mode`. Reasons accumulate.

| # | Condition | Mode | Timing | Why it is a real change |
| --- | --- | --- | --- | --- |
| R1 | `urgency = high` **or** essential deadline < 24 h **or** (`isSensitive` and relationship ∈ {landlord, employer}) | `instant` | now, quiet hours ignored | **Format + timing change.** Voicing and rendering are skipped for the first send. The student gets the actions as a text card within seconds. The reel follows as a reply to that card when it is ready. |
| R2 | `urgency = medium`, or `low` with a deadline < 72 h | `reel` | now, **unless** inside quiet hours → held until `quiet_end` | **Timing change.** Rendering happens immediately; delivery waits. |
| R3 | `urgency = low` and no deadline < 72 h | `digest` | next digest slot (08:00 or 18:00 local) | **Delivery-method change.** Reel is rendered and stored, then delivered inside one "while you were away" bundle with the other digest items. |

Tone (independent of mode):

| Relationship | Default `replyTone` | Interpretation prompt line |
| --- | --- | --- |
| professor, employer, landlord | `respectful_student` | "The sender is the student's {relationship}; keep the narration formal and use the sender's title." |
| peer | `warm` | "The sender is a peer; keep the narration casual." |
| other / unset | `prefs.replyTone` | (none) |

The student's explicit tone on `🔁 Regenerate` still overrides. Nothing is sent without the approve tap.

### 1.3 Worked examples (use as test cases and as the demo)

| Fixture | Context | Plan |
| --- | --- | --- |
| `professor_deadline` at 14:00 Tue | high urgency, deadline Wed for extension, professor | `instant`, now, `respectful_student`. Reason: "Sent right away: high urgency, deadline in 26 h." Card first, reel follows. |
| `landlord_docs` at 23:10 | medium, sensitive, landlord | `instant` (R1 sensitive + landlord), now, `respectful_student`. |
| `manager_steps` at 23:10 | medium, employer | `reel`, held until 08:00. Reason: "Held until 8:00 AM: outside your quiet hours." |
| `bilingual` from a peer at 15:00 | low, no deadline, peer | `digest`, delivered 18:00, `warm`. Reason: "Bundled into your 6:00 PM digest: low urgency." |
| `ambiguous_date` at 15:00 | low, `dueAt = null` (ambiguous) | `reel`, now. Ambiguous deadlines never go to digest (R2 treats an ambiguous essential item as "deadline unknown, < 72 h"). |

## 2. Pipeline changes (Dev A)

`apps/server/src/worker/generateReel.ts` — insert after the faithfulness check:

```
analyzing ──► decideDelivery ──► plan saved to processing_jobs.delivery_plan
                 │
   ┌─────────────┼───────────────────────┐
   ▼             ▼                       ▼
instant        reel                    digest
sendInstantCard  voicing→rendering       voicing→rendering
   │           status: held             status: held
voicing→rendering  (deliver_after set)  (deliver_after = next slot)
sendReel(replyTo=card)   ▼                 ▼
   ▼          scheduler releases      scheduler bundles per user
complete       ──► delivering ──► complete
```

Concrete edits:

1. **`decideDelivery.ts`** (new, pure) + `apps/server/test/decideDelivery.test.ts` (table-driven, the five examples above plus quiet-hours boundaries at 21:59 / 22:00 / 07:59 / 08:00).
2. **`generateReel.ts`**
   - `repository.profile()` also returns `relationship` (join `tracked_entities` on the message's `sender_external_id` + `connection_id`) and `quietHours`.
   - After `analyzing`: `const plan = decideDelivery(...)`; `repo.update(messageId, { delivery_plan: plan })`.
   - `mode === "instant"`: new stage `"notifying"` → `deps.delivery.sendInstantCard(target, artifactWithoutVideo, plan)`; store the returned Telegram message id in `reel_artifacts.instant_message_id`. Failure here is **non-fatal** (log, continue to render).
   - After rendering: if `plan.deliverAfter && new Date(plan.deliverAfter) > now` → `repo.update({ status: "held", deliver_after })` and **return** (do not deliver). Otherwise deliver as today, passing `replyToMessageId: instant_message_id` when present.
3. **`worker/scheduler.ts`** (new): `setInterval(30 s)` in `worker/index.ts`. Query `processing_jobs where status='held' and deliver_after <= now()`. For each user: if all released jobs are `digest`, send one header `☀️ 3 messages while you were away` then each reel; otherwise deliver each. Set `delivering → complete`. Idempotent: claim with `update … where status='held' returning *`.
4. **Migration `supabase/migrations/0002_context.sql`** (A-owned):
   ```sql
   alter table public.processing_jobs drop constraint processing_jobs_status_check;
   alter table public.processing_jobs add constraint processing_jobs_status_check
     check (status in ('queued','analyzing','notifying','voicing','rendering','held','delivering','complete','failed'));
   alter table public.processing_jobs add column delivery_plan jsonb, add column deliver_after timestamptz;
   create index processing_jobs_held on public.processing_jobs (deliver_after) where status = 'held';
   alter table public.reel_artifacts add column instant_message_id text;
   alter table public.tracked_entities add column relationship text not null default 'other'
     check (relationship in ('professor','employer','landlord','peer','other'));
   alter table public.preferences add column quiet_start text not null default '22:00',
                                  add column quiet_end   text not null default '08:00';
   ```
5. **Shared** (`packages/shared`): `delivery.ts` (schemas above), `SenderRelationshipSchema`, `UserPreferencesSchema` gains `quietStart` / `quietEnd`, `DeliveryConnector` gains
   `sendInstantCard(targetId, artifact, plan): Promise<string>` and `sendReel(targetId, artifact, opts?: { replyToMessageId?: string; plan?: DeliveryPlan })`.
6. **`engine/prompts.ts`**: `interpretationSystem` takes `relationship` and appends the tone line from §1.2. `replySystem` unchanged (tone already a parameter).
7. **`DEMO_NOW`** env (`config.ts`, optional ISO): when set, `now` in `decideDelivery` and the scheduler is this value. Lets us demonstrate quiet hours at 2 PM on stage. Also `pnpm demo:inject <fixture> --at 23:10`.

## 3. Connector, API and web changes (Dev B)

1. **`TelegramDelivery.sendInstantCard`**: `sendMessage` with
   `⚡ <sender> · Slack · sent right away\n<shortTitle>\n\n<actions>\n\n<i>reasonText</i>\n🎬 full reel is on its way` + the existing `[📄 Original][✅ Actions][✍️ Reply][👍 Got it]` keyboard. All buttons already resolve by message id, so the student can reply **before the reel exists**.
2. **`sendReel` follow-up**: when `replyToMessageId` is set, pass `reply_parameters: { message_id }` so the video threads under the card; caption gains the `reasonText` line. For held / digest deliveries the caption gets `⏰ Held until 8:00 AM · quiet hours` / `☀️ From your 6:00 PM digest`.
3. **`reply.ts`**: `draftFor` uses `plan.replyTone` (from `processing_jobs.delivery_plan`) instead of `prefs.replyTone` when a plan exists.
4. **API**: `PUT /api/tracked-entities` accepts `relationship`; `PATCH /api/preferences` accepts `quietStart` / `quietEnd`; `GET /api/messages` items gain `deliveryMode`, `deliverAfter`, `reasonText`; `GET /api/messages/:id` returns `job.deliveryPlan`. Update `MessageDetailResponse` in `packages/shared/src/api.ts` (Dev B section).
5. **Web**:
   - `SenderPicker.tsx`: relationship dropdown next to the sender (Professor / Employer / Landlord / Peer / Other).
   - `SetupView.tsx`: quiet hours row (two time inputs).
   - `HistoryView.tsx` / `MessageDetail.tsx`: plan chip — `⚡ Instant` / `🎬 Reel` / `☀️ Digest` — plus `reasonText`, and for held jobs a countdown "delivers at 8:00 AM".
   - `JobStatus.tsx`: add `notifying` and `held` to the stage list.

## 4. Schedule (both devs, ~4.5 h)

| Slot | Dev A | Dev B |
| --- | --- | --- |
| 0:00–0:30 | Migration 0002, shared schemas, `profile()` join | Relationship field end-to-end (API + SenderPicker), quiet hours in prefs API |
| 0:30–1:30 | `decideDelivery` + tests green | `sendInstantCard`, `sendReel` reply threading |
| 1:30–2:30 | Worker branch: instant path, held path, `DEMO_NOW` | History / detail chips, `reply.ts` tone from plan |
| 2:30–3:30 | `scheduler.ts` + digest bundling, `demo:inject --at` | Quiet-hours UI, `JobStatus` stages, `MessageDetailResponse` |
| 3:30–4:30 | Fixture expected plans, smoke run of the three demo paths | Pitch card, screenshots, README section |

**Cut order if behind:** digest bundling (R3 collapses into R2) → quiet-hours hold → relationship-driven tone.
**Never cut:** R1 instant path. It alone satisfies the brief: context (urgency + deadline) changes the format, the timing and the workflow.

## 5. Acceptance — what the judges must be able to see

1. Two fixtures injected back-to-back through the **same** pipeline take **visibly different paths**: `professor_deadline` lands as a text card in ~5 s and the reel threads under it; `manager_steps` at 23:10 (via `DEMO_NOW`) renders but shows "held until 8:00 AM" in History and nothing arrives in Telegram until the clock is advanced.
2. Every delivery carries a one-line **reason** in the student's language, and History shows the same reason. The decision is explainable, not a hidden heuristic.
3. Changing the sender's relationship from Professor to Peer and pressing Regenerate produces a different default tone without touching preferences.
4. Tests: `decideDelivery.test.ts` (rules and boundaries), worker test asserting `sendInstantCard` is called **before** `renderer.render` for high urgency and never for low, scheduler test asserting a held job is released exactly once.

## 6. Mapping to the brief (for the pitch card)

| Brief requirement | Our answer |
| --- | --- |
| Problem stays the same | Important messages are missed because of wrong format, place, tone or moment. |
| User stays the same | International student receiving English messages from authority figures. |
| Context used | Urgency, deadline proximity, time of day / quiet hours, relationship to sender. |
| What the context changes | **Delivery method** (text-first vs reel vs digest), **timing** (now vs held vs slot), **format** (card vs video), **tone** of the drafted reply, and the **workflow** (render-then-deliver vs deliver-then-render). |
| Not just display | The urgency chip existed before this pivot. What is new is that the same message on a different day, from a different sender, at a different hour, takes a different path through the system. |

One-sentence pitch: *"ReelRelay used to translate every message the same way. Now it triages: an urgent deadline from your professor interrupts you as a text card in seconds with the reel behind it, a routine note from a classmate waits for your evening digest, and nothing pings you at midnight unless it truly cannot wait."*

## 7. Open questions for the team

- Digest slots fixed at 08:00 / 18:00, or one user-configurable slot? (Plan assumes fixed; configurable is a 20-minute add.)
- Should `instant` also send a Telegram push with `disable_notification: false` while everything else is silent? Cheap and very demoable.
- Do we let the student tap "Deliver now" on a held item from History? Nice for the demo, not required for the brief.
