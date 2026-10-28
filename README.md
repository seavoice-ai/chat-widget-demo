# Chat widget demo

A small, standalone reference for embedding a Seavoice Studio chat agent on your own website:
a live chat widget next to the exact code you'd copy to build it yourself.

It runs in one of two modes, picked by whether the Studio channel has a **Follow-up Callback URL**:

- **Simple** — your chat server calls Studio and Studio answers. Every exchange starts with a
  message from your user.
- **Callback** — the same, plus Studio can call your server on its own: a "still there?" check-in
  when a user goes quiet, or a late answer when the agent failed to reply in time.

## The two modes side by side

| | Simple | Callback |
|---|---|---|
| **Direction of calls** | Your server → Studio only | Your server → Studio, and Studio → your server |
| **Studio channel** | No Follow-up Callback URL | Follow-up Callback URL pointing at your server's `/api/callback` |
| **Secrets your server holds** | API secret | API secret + callback secret |
| **Env vars** | `STUDIO_BASE_URL`, `STUDIO_CHANNEL_ID`, `STUDIO_API_SECRET` | The same, plus `STUDIO_CALLBACK_SECRET` |
| **Routes you build** | `/api/messages` | `/api/messages` + `/api/callback` |
| **Server must be publicly reachable** | No — `localhost` is fine | Yes — Studio has to reach the callback URL (use a tunnel when running locally) |
| **Streamed replies** | Yes | Yes |
| **Studio continues the user's open conversation** (keyed by `external_user_id`) | Yes | Yes |
| **"Still there?" check-in when the user goes quiet** (`follow_up`) | No | Yes, while the agent's **Enable Follow-Up** setting is on |
| **Late answer when the agent fails to reply** (`recovered_reply`) | No — Studio doesn't retry, so the user has to send again | Yes — Studio re-runs the turn and delivers the answer, whether or not Enable Follow-Up is on |
| **Reaching a user who has left the page** | Not possible | Store the message for their next visit, or push a notification through your own setup |
| **Good fit for** | A general website chat widget — anonymous visitors who are usually gone before a check-in would arrive, or anywhere you don't want the agent to message first | Signed-in users you can reach later, e.g. an app with its own push notifications |

To switch modes, set or clear the channel's callback URL in Studio (**Developer Settings → Chat
Channels**, the channel's actions menu → **Edit callback URL**), set or clear
`STUDIO_CALLBACK_SECRET` to match, and restart the dev server. Nothing in the request to Studio
changes between modes — the old per-request `follow_up` field is gone, and Studio ignores it if
sent.

## Files

- [`app/api/messages/route.ts`](./app/api/messages/route.ts) — your backend, **both modes**. Holds
  your chat channel's API secret server-side, signs each request, and forwards it to Studio's
  signed chat API, streaming the reply back. The browser never sees the secret.
- [`app/components/chat-widget.tsx`](./app/components/chat-widget.tsx) — your frontend, **both
  modes**. A chat UI built on [`@ai-sdk/react`](https://ai-sdk.dev)'s `useChat`, talking only to
  the route above.
- [`lib/studio-signing.ts`](./lib/studio-signing.ts) — the Standard Webhooks helpers: signing
  requests to Studio (**both modes**) and verifying deliveries from Studio (**callback mode**).
- [`app/api/callback/route.ts`](./app/api/callback/route.ts) — your receiver, **callback mode
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

1. In Studio, go to **Developer Settings → Chat Channels** and create a **Direct API** channel
   for the agent you want this demo to talk to.
   - **Simple mode:** leave **Follow-up Callback URL** blank.
   - **Callback mode:** set **Follow-up Callback URL** to `{your demo's public base URL}/api/callback`.
     Studio has to reach it, so when running locally, expose port 3000 through a tunnel (e.g.
     `ngrok http 3000`) and use that URL — `http://localhost:3000/api/callback` only works if
     Studio itself runs on your machine. Then turn on **Enable Follow-Up** in the agent's
     settings if you want check-ins (**Idle timeout** and **Idle Retries** set when and how
     often they're sent).
2. Copy the **API secret** and — in callback mode — the **Callback secret** from the dialog Studio
   shows after Create. Each secret is shown only once (the actions menu can regenerate either).
   The dialog's **Webhook URL** is Studio's own endpoint for this channel — what
   `app/api/messages/route.ts` calls — not your callback URL. Copy the channel id from the
   table's **Channel ID** column.
3. Fill in `.env.local`:

| Variable | What it is |
|---|---|
| `STUDIO_BASE_URL` | Your Studio deployment's base URL, e.g. `https://your-company.seavoice.ai` |
| `STUDIO_CHANNEL_ID` | The chat channel's id, from step 2 |
| `STUDIO_API_SECRET` | The channel's API secret, from step 2 |
| `STUDIO_CALLBACK_SECRET` | **Callback mode only** — the channel's callback secret, from step 2. Leave blank for simple mode |

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

The request body Studio takes:

| Field | |
|---|---|
| `external_user_id` | Required. Your own stable id for this user — shown as the Customer ID in Chat Logs |
| `message.text` | Required. What the user typed |
| `name` | Optional, at most 200 characters. The user's name, shown as the Customer Name in Chat Logs |
| `client_customer_id` | Optional, at most 200 characters. Links the conversation to the Studio customer with that Client Customer ID, so the agent gets that customer's data |
| `thread_id` | Optional. Continue a specific conversation Studio handed back (the `X-Thread-Id` response header). Leave it out to continue the user's open one |

This demo's visitors are anonymous, so it sends only `external_user_id` and `message`. If you send
`name` or `client_customer_id`, take them from your own signed-in session — never from what the
browser sends you, or a visitor could pull another customer's data into the agent's replies.

A reply can come in several messages: an agent that looks something up says so first ("Let me
check that for you"), then answers in a later step. With `?stream=true` they arrive as one
streamed [AI SDK](https://ai-sdk.dev) UI message with a `step-start` part between them, and the
widget shows each step as its own bubble. Without `?stream=true`, Studio answers with JSON instead:
`{ thread_id, replies: [{ id, text }, …], reply }`, where `reply` is the last of `replies`.

### Callback mode

Everything above, plus a second direction that Studio starts on its own:

```
Studio
  -> POST {your Follow-up Callback URL}             (when the conversation goes quiet, or the
      (signed with the channel's callback            agent failed to answer in time)
       secret — a DIFFERENT secret from the
       API secret above)
      -> this repo's /api/callback route verifies it, skips a webhook-id it has already
         handled, and saves the message so it shows on the next reload
```

Each delivery is `{ version, thread_id, external_user_id, message: { id, kind, text } }`, and
`message.kind` says which of the two it is:

- **`follow_up`** — a check-in. The agent spoke last and the user has gone quiet for longer than
  the agent's **Idle timeout**. Only sent while the agent's **Enable Follow-Up** setting is on, up
  to **Idle Retries** times per silence.
- **`recovered_reply`** — a late answer. The agent never answered the user's last message (a
  provider error, a timeout, a crash), so Studio re-ran the turn and is delivering the reply now.
  Sent whenever the channel has a callback URL, whether or not Enable Follow-Up is on.

Your receiver has to answer with a `2xx` within 10 seconds. If it can't be reached, times out, or
answers `408`, `429` or a `5xx`, Studio tries again straight away — up to three tries, with the same
`webhook-id`, which is why the receiver skips one it has already handled. If every try fails, or
the receiver answers any other status, the message is marked not sent in Chat Logs and Studio sends
that user nothing more until they write again.

### Two secrets, two directions

A chat channel can have two separate secrets, used in opposite directions — see
`lib/studio-signing.ts` for both:

- **API secret** (both modes) — your backend signs *outgoing* calls to Studio with it
  (`chat/web/{channel_id}/messages`). Studio verifies the signature using its own copy.
- **Callback secret** (callback mode only) — Studio signs *outgoing* deliveries to your Follow-up
  Callback URL with it. Your backend verifies the signature using its own copy. Studio mints it
  the first time the channel gets a callback URL; changing or clearing the URL keeps it.

Never use one in place of the other — Studio rejects a message signed with the callback secret,
and your callback receiver should reject a delivery signed with the API secret.
