'use client';

import { useState } from 'react';

// These snippets are a condensed, framework-agnostic rewrite of
// app/api/messages/route.ts and app/components/chat-widget.tsx — same two
// calls (browser -> your backend -> Studio), simplified for a README.
// Keep them in sync by hand if those files' request/response shape changes.

const BACKEND_SNIPPET = `// your-backend/chat.js
// Holds the real Studio API key — never ship this to the browser.
export async function POST(req) {
  const { external_user_id, message } = await req.json();

  const reply = await fetch(
    \`\${process.env.STUDIO_BASE_URL}/api/external/2026-07/chat/messages?stream=true\`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.STUDIO_API_KEY,
      },
      body: JSON.stringify({
        assistant_id: process.env.STUDIO_ASSISTANT_ID,
        external_user_id,
        message,
      }),
    }
  );

  // Pipe the streamed reply straight back to the browser.
  return new Response(reply.body, { status: reply.status });
}`;

const FRONTEND_SNIPPET = `// your-site/chat-widget.js
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
  const { messages, sendMessage, status } = useChat({ transport });
  // render \`messages\`, call sendMessage({ text }) from your input box
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

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-md" style={{ background: 'var(--code-bg)' }}>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-gray-400">
        <span className="font-mono">{title}</span>
        <CopyButton code={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs text-gray-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CodePanel() {
  return (
    <div
      className="flex min-h-[32rem] flex-col gap-4 rounded-lg border p-4"
      style={{ borderColor: 'var(--border)' }}
    >
      <div>
        <div className="font-medium">The code</div>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Two files: a backend route that holds your API key, and a frontend widget that talks
          only to your own backend.
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-auto">
        <CodeBlock title="your-backend/chat.js" code={BACKEND_SNIPPET} />
        <CodeBlock title="your-site/chat-widget.js" code={FRONTEND_SNIPPET} />
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Your backend needs <code>STUDIO_BASE_URL</code>, <code>STUDIO_API_KEY</code> (a workspace
        key from Developer Settings → API Keys) and <code>STUDIO_ASSISTANT_ID</code> (this
        agent&apos;s id). The key never reaches the browser.
      </p>
    </div>
  );
}
