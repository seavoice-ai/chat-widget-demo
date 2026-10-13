# Chat widget demo

A small, standalone reference for embedding a Seavoice Studio chat agent on your own website:
a live chat widget next to the exact code you'd copy to build it yourself.

The two files that matter are:

- [`app/api/messages/route.ts`](./app/api/messages/route.ts) — your backend. Holds your Studio
  API key server-side and forwards each message to Studio's chat API, streaming the reply back.
  The browser never sees the key.
- [`app/components/chat-widget.tsx`](./app/components/chat-widget.tsx) — your frontend. A chat
  UI built on [`@ai-sdk/react`](https://ai-sdk.dev)'s `useChat`, talking only to the route above.

Everything else in this repo (layout, styling, the code panel) is just this demo page's own
scaffolding, not part of the pattern to copy.

## Setup

```bash
pnpm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | What it is |
|---|---|
| `STUDIO_BASE_URL` | Your Studio deployment's base URL, e.g. `https://your-company.seavoice.ai` |
| `STUDIO_API_KEY` | A workspace API key from Studio → Developer Settings → API Keys |
| `STUDIO_ASSISTANT_ID` | The id of the agent this demo should chat with |

Then:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## How it works

```
Browser (this page)
  -> POST /api/messages                 (this repo's backend route)
      -> POST {STUDIO_BASE_URL}/api/external/2026-07/chat/messages?stream=true
         (Studio's real external chat API, called with your API key)
      <- streamed reply
  <- streamed reply
```

The backend route validates the incoming message, caps its length, rate-limits by IP, and maps
any upstream failure to a generic error — adapt those to your own stack's conventions, but keep
the core shape: **your backend holds the key, your frontend only talks to your backend.**
