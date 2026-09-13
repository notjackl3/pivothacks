# Composio inbound setup

ReelRelay uses Composio only for inbound account authorization and message triggers. Reel generation remains inside
ReelRelay and every reel is delivered over Telegram (see [TELEGRAM-SETUP.md](./TELEGRAM-SETUP.md)). Composio never
delivers anything outbound.

## 1. Create the Composio project

1. Create a project at <https://platform.composio.dev/>.
2. Copy its project API key into `COMPOSIO_API_KEY` in the server `.env`.
3. Use Composio-managed OAuth for the demo. Custom OAuth apps can be added later for ReelRelay branding and custom scopes.

## 2. Create auth configs

In the Composio dashboard, create one auth config for each provider you want to show. Start with Gmail and Slack.
WhatsApp only works with a WhatsApp Business Account; Instagram needs a professional account linked to a Meta app.

Copy each `ac_...` auth config ID into `COMPOSIO_AUTH_CONFIGS`:

```dotenv
COMPOSIO_AUTH_CONFIGS={"gmail":"ac_...","slack":"ac_..."}
```

Supported toolkits: `gmail`, `slack`, `outlook`, `whatsapp`, `instagram`. Only configured toolkits become clickable in
ReelRelay, so a toolkit with no auth config id stays greyed out on `/setup`.

## 3. Confirm inbound trigger slugs

Open the toolkit's Triggers section in Composio and copy the exact current inbound trigger slug. Configure it rather than relying on a name from an older SDK version:

```dotenv
COMPOSIO_TRIGGER_SLUGS={"gmail":"GMAIL_NEW_GMAIL_MESSAGE","slack":"SLACK_DIRECT_MESSAGE_RECEIVED"}
COMPOSIO_TRIGGER_CONFIGS={"gmail":{"query":"label:inbox","labelIds":"INBOX","interval":2},"slack":{}}
```

The server creates the trigger automatically after the user finishes OAuth. Trigger versions currently resolve to `latest`; pin dated toolkit versions before production if a payload contract becomes stable.

## 4. Create the signed webhook subscription

1. Make the server publicly available over HTTPS.
2. In Composio, create a V3 webhook subscription pointing to `https://YOUR_API_HOST/webhooks/composio`.
3. Enable `composio.trigger.message` and `composio.connected_account.expired`.
4. Copy the signing secret shown at creation into `COMPOSIO_WEBHOOK_SECRET`.

ReelRelay checks the `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers, rejects events older than five minutes, and deduplicates every event before creating a job.

For local testing, Composio documents this forwarding command:

```bash
composio dev triggers listen --forward "http://localhost:4000/webhooks/composio"
```

Use the signing secret printed by the CLI when forwarding locally.

## 5. Test the user flow

1. Apply `0001_init.sql`, `0002_context.sql`, and `0003_inbound_sources.sql` in order.
2. Start ReelRelay with `pnpm dev`.
3. Sign in and open `/setup`.
4. Pair Telegram first (**Setup → Telegram → Get pairing code → Open Telegram → Start**); nothing can be delivered
   until a Telegram chat is paired, and the worker fails the job with `TELEGRAM_NOT_PAIRED`.
5. Select Gmail, Slack, Outlook, WhatsApp or Instagram under **Connected inboxes**.
6. Complete the hosted Composio consent screen. It redirects back to `/setup`.
7. Wait for the source to display **Connected**. ReelRelay creates the inbound trigger during this reconciliation.
8. Send a new source message and confirm that it appears in history and arrives in Telegram — an ⚡ instant card for
   urgent messages, the 🎬 reel threaded under it, or a held reel released at the end of quiet hours.

## Before production

- Configure Composio callback identity verification to prevent a Connect Link from being shared and attached to the wrong signed-in user.
- Use custom OAuth apps and the smallest read scopes that provide full message bodies.
- Add sender/folder filters before enabling high-volume inboxes.
- Pin toolkit versions and save representative real payload fixtures for every provider.
- Add an explicit disconnect flow that revokes the Composio connected account and deletes its trigger.
- Update the privacy policy to name Composio, Anthropic, ElevenLabs, Supabase, and Telegram as processors/subprocessors as applicable.
