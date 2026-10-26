# Chat widget demo

A small, standalone reference for embedding a Seavoice Studio chat agent on your own website:
a live chat widget next to the exact code you'd copy to build it yourself.

It runs in one of two modes, picked by whether `STUDIO_WEBHOOK_SECRET` is set:

- **Simple** — your chat server calls Studio and Studio answers. Every exchange starts with a
  message from your user.
- **Webhook** — the same, plus Studio can call your server on its own: a "still there?" check-in
  when a user goes quiet, or a late answer when the agent failed to reply in time.

## The two modes side by side

| | Simple | Webhook |
|---|---|---|
| **Direction of calls** | Your server → Studio only | Your server → Studio, and Studio → your server |
| **Studio channel** | No webhook URL | Webhook URL pointing at your server's `/api/webhook` |
| **Secrets your server holds** | API secret | API secret + webhook secret |
| **Env vars** | `STUDIO_BASE_URL`, `STUDIO_CHANNEL_ID`, `STUDIO_API_SECRET` | The same, plus `STUDIO_WEBHOOK_SECRET` |
| **Routes you build** | `/api/messages` | `/api/messages` + `/api/webhook` |
| **Server must be publicly reachable** | No — `localhost` is fine | Yes — Studio has to reach the webhook URL (use a tunnel when running locally) |
| **`follow_up` on each request** | Off — Studio rejects `follow_up: true` with a `400` when the channel has no webhook URL | On |
| **Streamed replies** | Yes | Yes |
| **Studio continues the user's open conversation** (keyed by `external_user_id`) | Yes | Yes |
| **"Still there?" check-in when the user goes quiet** (`follow_up`) | No | Yes, for conversations with `follow_up` on |
| **Late answer when the agent fails to reply** (`recovered_reply`) | No — Studio doesn't retry, so the user has to send again | Yes — Studio re-runs the turn and delivers the answer, with or without `follow_up` |
| **Reaching a user who has left the page** | Not possible | Store the message for their next visit, or push a notification through your own setup |
| **Good fit for** | A general website chat widget — anonymous visitors who are usually gone before a check-in would arrive, or anywhere you don't want the agent to message first | Signed-in users you can reach later, e.g. an app with its own push notifications |

To switch modes, set or clear `STUDIO_WEBHOOK_SECRET` and restart the dev server.

## Files

- [`app/api/messages/route.ts`](./app/api/messages/route.ts) — your backend, **both modes**. Holds
  your web chat channel's API secret server-side, signs each request, and forwards it to Studio's
  signed chat API, streaming the reply back. The browser never sees the secret. Turns
  `follow_up` on when `STUDIO_WEBHOOK_SECRET` is set.
- [`app/components/chat-widget.tsx`](./app/components/chat-widget.tsx) — your frontend, **both
  modes**. A chat UI built on [`@ai-sdk/react`](https://ai-sdk.dev)'s `useChat`, talking only to
  the route above.
- [`lib/studio-signing.ts`](./lib/studio-signing.ts) — the Standard Webhooks helpers: signing
  requests to Studio (**both modes**) and verifying deliveries from Studio (**webhook mode**).
- [`app/api/webhook/route.ts`](./app/api/webhook/route.ts) — your receiver, **webhook mode
  only**. Verifies and handles the check-ins and late answers Studio sends to your server.

Everything else in this repo (layout, styling, the code panel, `app/api/history/route.ts` +
`lib/message-store.ts`) is just this demo page's own scaffolding, not part of the pattern to copy.
`app/api/history` in particular exists only so reloading this page restores the conversation — it's
an in-memory, process-local store keyed by `external_user_id`, not something a real integration
needs (Studio's own chat API already keeps the real conversation history).

## Setup

```bash
pnpm install
cp .env.example .env.local
```

1. In Studio, go to **Developer Settings → Chat Channels** and create a **Web-based Chat**
   channel for the agent you want this demo to talk to.
   - **Simple mode:** leave the webhook URL blank.
   - **Webhook mode:** set the webhook URL to `{your demo's public base URL}/api/webhook`. Studio
     has to reach it, so when running locally, expose port 3000 through a tunnel (e.g.
     `ngrok http 3000`) and use that URL — `http://localhost:3000/api/webhook` only works if
     Studio itself runs on your machine.
2. Copy the channel id, the **API secret**, and — in webhook mode — the **webhook secret**. Each
   secret is shown only once.
3. Fill in `.env.local`:

| Variable | What it is |
|---|---|
| `STUDIO_BASE_URL` | Your Studio deployment's base URL, e.g. `https://your-company.seavoice.ai` |
| `STUDIO_CHANNEL_ID` | The web chat channel's id, from step 1 |
| `STUDIO_API_SECRET` | The channel's API secret, from step 2 |
| `STUDIO_WEBHOOK_SECRET` | **Webhook mode only** — the channel's webhook secret, from step 2. Leave blank for simple mode |

Then:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## How it works

### Simple mode

```
Browser (this page)
  -> POST /api/messages                           (this repo's backend route)
      -> POST {STUDIO_BASE_URL}/api/external/2026-07/chat/web/{channel_id}/messages?stream=true
         (Studio's signed Web Chat API — signed with the channel's API secret, not a workspace key)
      <- streamed reply
  <- streamed reply
```

The backend route validates the incoming message, caps its length, rate-limits by IP, signs the
request, and maps any upstream failure to a generic error — adapt those to your own stack's
conventions, but keep the core shape: **your backend holds the channel's secrets, your frontend
only talks to your backend.**

### Webhook mode

Everything above, with `follow_up: true` on each request, plus a second direction that Studio
starts on its own:

```
Studio
  -> POST {your webhook URL}                       (when the conversation goes quiet, or the
      (signed with the channel's webhook             agent failed to answer in time)
       secret — a DIFFERENT secret from the
       API secret above)
      -> this repo's /api/webhook route verifies it, skips a webhook-id it has already
         handled, and saves the message so it shows on the next reload
```

Each delivery's `message.kind` says which of the two it is:

- **`follow_up`** — a check-in. The agent spoke last and the user has gone quiet for longer than
  the agent's follow-up delay. Only sent for conversations with `follow_up` on.
- **`recovered_reply`** — a late answer. The agent never answered the user's last message (a
  provider error, a timeout, a crash), so Studio re-ran the turn and is delivering the reply now.
  Sent whenever the channel has a webhook URL, whether or not `follow_up` is on.

Your receiver has to answer with a `2xx` within 10 seconds. Anything else counts as not delivered,
and Studio sends a new message about 5 minutes later.

This demo turns `follow_up` on for every request in webhook mode, so `/api/webhook` has something
to receive — a real integration should only send `follow_up: true` when the user actually wants
check-ins.

### Two secrets, two directions

A web chat channel can have two separate secrets, used in opposite directions — see
`lib/studio-signing.ts` for both:

- **API secret** (both modes) — your backend signs *outgoing* calls to Studio with it
  (`chat/web/{channel_id}/messages`). Studio verifies the signature using its own copy.
- **Webhook secret** (webhook mode only) — Studio signs *outgoing* deliveries to your webhook URL
  with it. Your backend verifies the signature using its own copy.

Never use one in place of the other — Studio rejects a message signed with the webhook secret,
and your webhook receiver should reject a delivery signed with the API secret.
