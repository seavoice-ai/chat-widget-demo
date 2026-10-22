# Chat widget demo

A small, standalone reference for embedding a Seavoice Studio chat agent on your own website:
a live chat widget next to the exact code you'd copy to build it yourself.

The files that matter are:

- [`app/api/messages/route.ts`](./app/api/messages/route.ts) — your backend. Holds your web
  chat channel's API secret server-side, signs each request, and forwards it to Studio's
  signed chat API, streaming the reply back. The browser never sees the secret.
- [`app/components/chat-widget.tsx`](./app/components/chat-widget.tsx) — your frontend. A chat
  UI built on [`@ai-sdk/react`](https://ai-sdk.dev)'s `useChat`, talking only to the route above.
- [`app/api/webhook/route.ts`](./app/api/webhook/route.ts) — your follow-up receiver. Verifies
  and handles the check-in Studio sends to your server when a conversation goes quiet. Only
  needed if you want follow-ups.
- [`lib/studio-signing.ts`](./lib/studio-signing.ts) — the Standard Webhooks signing/verification
  helpers the two routes above share.

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
   channel for the agent you want this demo to talk to. Add a webhook URL (e.g.
   `http://localhost:3000/api/webhook` while running locally) if you want to try follow-ups —
   otherwise leave it blank.
2. Copy the channel id, the **API secret**, and — if you added a webhook URL — the
   **webhook secret**. Each secret is shown only once.
3. Fill in `.env.local`:

| Variable | What it is |
|---|---|
| `STUDIO_BASE_URL` | Your Studio deployment's base URL, e.g. `https://your-company.seavoice.ai` |
| `STUDIO_CHANNEL_ID` | The web chat channel's id, from step 1 |
| `STUDIO_API_SECRET` | The channel's API secret, from step 2 |
| `STUDIO_WEBHOOK_SECRET` | The channel's webhook secret — only needed if the channel has a webhook URL |

Then:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## How it works

```
Browser (this page)
  -> POST /api/messages                           (this repo's backend route)
      -> POST {STUDIO_BASE_URL}/api/external/2026-07/chat/web/{channel_id}/messages?stream=true
         (Studio's signed Web Chat API — signed with the channel's API secret, not a workspace key)
      <- streamed reply
  <- streamed reply

Studio
  -> POST {your webhook URL}                       (only if the channel has one, and the
      (a follow-up check-in, signed with the         conversation turned follow_up on)
       channel's webhook secret — a DIFFERENT
       secret from the one above)
      -> this repo's /api/webhook route verifies it and shows it on next reload
```

The backend route validates the incoming message, caps its length, rate-limits by IP, signs the
request, and maps any upstream failure to a generic error — adapt those to your own stack's
conventions, but keep the core shape: **your backend holds the channel's secrets, your frontend
only talks to your backend.**

Every message this demo sends turns `follow_up: true` on, specifically so `/api/webhook` has
something to receive if you configured a webhook URL — a real integration should only send
`follow_up: true` when the user actually wants check-ins.

### Two secrets, two directions

A web chat channel has two separate secrets, used in opposite directions — see
`lib/studio-signing.ts` for both:

- **API secret** — your backend signs *outgoing* calls to Studio with it (`chat/web/{channel_id}/messages`).
  Studio verifies the signature using its own copy.
- **Webhook secret** — Studio signs *outgoing* follow-ups to your webhook URL with it. Your
  backend verifies the signature using its own copy.

Never use one in place of the other — Studio rejects a message signed with the webhook secret,
and your webhook receiver should reject a delivery signed with the API secret.
