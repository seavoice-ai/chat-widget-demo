'use client';

import { useState } from 'react';

// These snippets are a condensed, framework-agnostic rewrite of
// app/api/messages/route.ts and app/components/chat-widget.tsx — same two
// calls (browser -> your backend -> Studio), simplified for a README.
// Keep them in sync by hand if those files' request/response shape changes.

const BACKEND_SNIPPET = `// your-backend/chat.js
// Holds the channel's API secret — never ship this to the browser.
import crypto from "node:crypto";

function signRequest(apiSecret, payload, id = crypto.randomUUID()) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(apiSecret.slice("whsec_".length), "base64");
  const sig = crypto
    .createHmac("sha256", key)
    .update(\`\${id}.\${ts}.\${payload}\`)
    .digest("base64");
  return { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": \`v1,\${sig}\` };
}

function callStudio(payload, query = "") {
  const channelId = process.env.STUDIO_CHANNEL_ID;
  const body = JSON.stringify(payload);
  const signedHeaders = signRequest(process.env.STUDIO_API_SECRET, body);

  return fetch(
    \`\${process.env.STUDIO_BASE_URL}/api/external/2026-07/chat/web/\${channelId}/messages\${query}\`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signedHeaders },
      body, // must be the exact string that was signed
    }
  );
}

export async function POST(req) {
  const { type, external_user_id, message } = await req.json();

  // The widget just opened: get the agent's First Message, as
  // { replies: [{ text }] } (empty if it has none). Stores nothing.
  if (type === "first_message") {
    const greeting = await callStudio({ type });
    return new Response(greeting.body, { status: greeting.status });
  }

  // For a signed-in user, you can add \`name\` and \`client_customer_id\` —
  // from YOUR session, never from the browser's request.
  const reply = await callStudio({ external_user_id, message }, "?stream=true");

  // Pipe the streamed reply straight back to the browser.
  return new Response(reply.body, { status: reply.status });
}`;

const FRONTEND_SNIPPET = `// your-site/chat-widget.js
import { useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const transport = new DefaultChatTransport({
  api: "/your-backend/chat", // the route above
  prepareSendMessagesRequest: ({ messages }) => {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const text = last?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("") ?? "";
    return {
      body: {
        external_user_id: getOrCreateVisitorId(), // any stable per-visitor id
        message: { text },
      },
    };
  },
});

function ChatWidget() {
  const { messages, setMessages, sendMessage, status } = useChat({ transport });

  // Greet the visitor when the widget opens. Studio starts every new
  // conversation with this same message, so show it. Skip this if you're
  // restoring a conversation that's already going.
  useEffect(() => {
    fetch("/your-backend/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "first_message" }),
    })
      .then((res) => res.json())
      .then(({ replies }) =>
        setMessages(replies.map(({ text }, i) => ({
          id: \`first-message-\${i}\`,
          role: "assistant",
          parts: [{ type: "text", text }],
        })))
      );
  }, [setMessages]);

  // render \`messages\`, call sendMessage({ text }) from your input box.
  // A reply can take several steps ("Let me check that…", then the
  // answer) — start a new bubble at each "step-start" part.
}`;

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-white/10"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** One column: a card shell matching ChatWidget's, holding exactly one file's
 *  code so it can sit in its own 1/3-width column and scroll independently. */
function CodeColumn({
  heading,
  description,
  filename,
  code,
}: {
  heading: string;
  description: string;
  filename: string;
  code: string;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col rounded-lg border"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <div className="font-medium">{heading}</div>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          {description}
        </p>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--code-bg)' }}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-gray-400">
          <span className="font-mono">{filename}</span>
          <CopyButton code={code} />
        </div>
        <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs text-gray-100">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

export function BackendCodePanel() {
  return (
    <CodeColumn
      heading="Your backend"
      description="Holds your channel's API secret, signs requests to Studio, returns the greeting and streams each reply back."
      filename="your-backend/chat.js"
      code={BACKEND_SNIPPET}
    />
  );
}

export function FrontendCodePanel() {
  return (
    <CodeColumn
      heading="Your frontend"
      description="Talks only to your own backend — never to Studio directly. Asks for the greeting when it opens."
      filename="your-site/chat-widget.js"
      code={FRONTEND_SNIPPET}
    />
  );
}
