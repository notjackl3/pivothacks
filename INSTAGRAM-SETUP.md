# Instagram delivery setup

This branch uses one Instagram professional account as the ReelRelay bot. End users can keep personal accounts; they pair by sending the bot a one-time code.

## 1. Create the bot account

1. Create a dedicated Instagram account (for example, `reelrelay_demo`).
2. In Instagram settings, open **Account type and tools** and choose **Switch to professional account**.
3. Choose **Creator** or **Business**. Either works for messaging. Complete the profile so a recipient recognizes the account.

Instagram sometimes exposes the account-type switch only in its mobile UI. The remaining setup is performed in a desktop browser.

## 2. Create the Meta app

1. Visit <https://developers.facebook.com/apps/> and choose **Create app**.
2. Choose a Business app/use case, then add the Instagram product.
3. Select **Instagram API with Instagram Login**. This flow does not require a linked Facebook Page.
4. In the Instagram API setup, connect the professional bot account.
5. Add every controlled demo account under app roles/testers and accept the invitation from each Instagram account.
6. Request these scopes for the generated token:
   - `instagram_business_basic`
   - `instagram_business_manage_messages`

Development mode is suitable for controlled app-role/test accounts. Public users require Live mode and Meta App Review for the messaging permission.

## 3. Configure the webhook

1. Start the server behind a stable HTTPS tunnel.
2. Choose a random value of at least 32 characters for `INSTAGRAM_VERIFY_TOKEN`.
3. In the Meta app's Instagram webhook settings, set:
   - Callback URL: `https://YOUR_API_HOST/webhooks/instagram`
   - Verify token: the exact `INSTAGRAM_VERIFY_TOKEN` value
4. Subscribe the Instagram account to the `messages` webhook field.
5. Meta will call the GET endpoint and the server will return its challenge.

Signed POST requests are validated with `X-Hub-Signature-256` and `INSTAGRAM_APP_SECRET`; unsigned requests fail closed.

## 4. Fill in `.env`

Copy `.env.example` to `.env` and set:

```dotenv
INSTAGRAM_ACCOUNT_ID=the-professional-instagram-account-id
INSTAGRAM_USERNAME=reelrelay_demo
INSTAGRAM_ACCESS_TOKEN=the-server-side-access-token
INSTAGRAM_APP_SECRET=the-meta-app-secret
INSTAGRAM_VERIFY_TOKEN=the-same-random-webhook-token
INSTAGRAM_API_VERSION=v23.0
```

The access token is server-only. Never add it to a `NEXT_PUBLIC_` variable or commit `.env`.

You can confirm the account ID and username with Meta's Graph API Explorer or:

```text
GET https://graph.instagram.com/v23.0/me?fields=id,user_id,username&access_token=YOUR_TOKEN
```

## 5. Apply and run

1. Apply `supabase/migrations/0002_instagram.sql` after `0001_init.sql`.
2. Run `pnpm dev`.
3. Open ReelRelay's `/setup` page and select **Pair Instagram**.
4. Open the displayed Instagram conversation and manually send the eight-character code.
5. Wait for “ReelRelay is connected.” The setup card should turn green within a few seconds.
6. Send a tracked Slack message and confirm that its reel arrives in the Instagram DM.

## Operational constraints

- The recipient must initiate the Instagram conversation.
- Instagram delivery is only selected while the stored inbound-message window is open; Telegram is retained as a fallback.
- The video is delivered using a one-hour signed Supabase URL that Meta fetches server-side.
- Stable Meta rejections are not retried; network and 5xx failures use the worker retry ladder.
- Dashboard-generated tokens are appropriate for a demo. Before production, implement long-lived-token renewal, App Review, deletion callbacks, privacy-policy URLs, and monitoring for Meta usage/error headers.
