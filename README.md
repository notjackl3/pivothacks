# ReelRelay

ReelRelay watches inboxes a user explicitly connects, converts new messages into short translated reels, and delivers them by DM from a dedicated Instagram professional account.

```text
Gmail / Slack / Outlook / WhatsApp Business
                    ↓ Composio OAuth + triggers
             ReelRelay processing pipeline
                    ↓ Meta Send API
               Instagram DM
```

## Local setup

1. Install Node 20.19+ and pnpm 10.27.
2. Run `pnpm install --frozen-lockfile`.
3. Copy `.env.example` to `.env` and configure Supabase plus the generation services.
4. Apply the Supabase migrations in numeric order.
5. Follow [COMPOSIO-SETUP.md](./COMPOSIO-SETUP.md) for inbound connections.
6. Follow [INSTAGRAM-SETUP.md](./INSTAGRAM-SETUP.md) for outbound delivery.
7. Run `pnpm dev`; the web app uses port 3000 and the API uses port 4000.

Use `pnpm test`, `pnpm typecheck`, and `pnpm build` before pushing changes.
