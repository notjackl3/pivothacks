# @reelrelay/web

Next.js 15.5 App Router front end for ReelRelay: magic-link sign-in, the Setup page (Slack, Telegram, tracked sender, language) and the History pages.

- `pnpm --filter @reelrelay/web dev` → http://localhost:3000
- Env comes from the monorepo root `.env` (loaded in `next.config.ts`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `API_BASE_URL` (Fastify origin; the browser only ever calls `/api/proxy/*`).
- In Supabase Auth → URL configuration, add `http://localhost:3000/auth/callback` (and the ngrok/app origin) to the redirect allow list.
