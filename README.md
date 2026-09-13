# ReelRelay

ReelRelay watches inboxes a user explicitly connects, converts new messages into short translated reels, and delivers
them to the user's phone as Telegram messages from a dedicated bot.

```text
Gmail / Slack / Outlook / WhatsApp / Instagram
                    ↓ Composio OAuth + triggers
             ReelRelay processing pipeline
                    ↓ Telegram Bot API
               Telegram chat
```

Inbound is Composio-only; outbound is Telegram-only. The two never share a provider: a message that arrives from an
Instagram DM still leaves as a Telegram reel.

## Local setup

1. Install Node 20.19+ and pnpm 10.27.
2. Run `pnpm install --frozen-lockfile`.
3. Copy `.env.example` to `.env` and configure Supabase plus the generation services.
4. Apply the Supabase migrations in numeric order.
5. Follow [TELEGRAM-SETUP.md](./TELEGRAM-SETUP.md) for outbound delivery, then run `pnpm telegram:check`.
6. Follow [COMPOSIO-SETUP.md](./COMPOSIO-SETUP.md) for inbound connections.
7. Run `pnpm dev`; the web app uses port 3000 and the API uses port 4000.

Use `pnpm test`, `pnpm typecheck`, and `pnpm build` before pushing changes.
