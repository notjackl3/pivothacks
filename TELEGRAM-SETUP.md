# Telegram setup (10 minutes)

The bot code is complete (`apps/server/src/delivery/telegram/*`). It only needs a token.

## 1. Create the bot

1. In Telegram, open **@BotFather** and send `/newbot`.
2. Name: `ReelRelay` (anything). Username: must end in `bot`, e.g. `reelrelay_demo_bot`.
3. BotFather replies with a token like `1234567890:AAF...`. Copy it.

## 2. Put it in `.env` (repo root, gitignored)

```
TELEGRAM_BOT_TOKEN=1234567890:AAF...
TELEGRAM_BOT_USERNAME=reelrelay_demo_bot
```

## 3. Verify

```
pnpm telegram:check
```

It validates the token, warns if the username is wrong, registers `/start` and `/help`, and removes any leftover webhook
(the server uses long polling). Every line should be ✅.

## 4. Run and pair

```
pnpm dev
```

Server log must show `telegram: polling as @<your bot>`. Then in the web app: **Setup → Telegram card → Get pairing code →
Open Telegram → Start**. The bot answers `Paired ✅`.

## 5. Send a reel

```
pnpm demo:inject professor_deadline
```

The chat gets the ⚡ instant card within seconds and the 🎬 reel threaded under it. For the held path:

```
pnpm demo:inject manager_steps --at 23:10     # rendered, held until 08:00 (History shows "Held")
pnpm demo:inject --clock 08:05                # move the demo clock; the scheduler delivers within 10 s
pnpm demo:inject --clock real                 # back to real time
```

## Gotchas

- Only one process may poll a bot token. If you see `409 Conflict` in the log, another `pnpm dev` is still running.
- Private bot chats need the user to press **Start** once; the pairing deep link does that.
- No `TELEGRAM_BOT_TOKEN` → the server logs `telegram: not started (no token)` and prints reels to the console instead.
