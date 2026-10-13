'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

const SESSION_STORAGE_KEY = 'chat-demo-user-id';

/** One id per browser tab session — stable across refreshes of this tab so the
 *  conversation continues, but never written to a cookie or localStorage. */
function getOrCreateUserId(): string {
  const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
  return created;
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

function toUIMessage(stored: StoredMessage): UIMessage {
  return { id: stored.id, role: stored.role, parts: [{ type: 'text', text: stored.text }] };
}

/** Demo-only: persists one message to this page's own history store (see
 *  app/api/history/route.ts) so a reload can restore the conversation. Not
 *  part of the integration pattern in the code panel — best-effort, fire and
 *  forget. */
function persistMessage(externalUserId: string, role: StoredMessage['role'], text: string) {
  if (!text.trim()) return;
  fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ external_user_id: externalUserId, role, text }),
  }).catch(() => {});
}

export function ChatWidget() {
  // Generated client-side only (not during SSR) so the id, and the first
  // request it unlocks, never depend on what the server happened to render.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    // sessionStorage doesn't exist during SSR — read it client-only on mount
    // rather than in useState's initializer, so the server and the first
    // client render agree (both null) and only this effect picks the real id.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(getOrCreateUserId());
  }, []);

  // Rebuilt only when userId changes (null -> its real value, once) — talks to
  // OUR backend proxy (app/api/messages/route.ts), reshaping useChat's default
  // `{ messages }` body into the `{ external_user_id, message }` shape that
  // route (and the real Studio chat API behind it) expects. The input stays
  // disabled until userId is set, so no send ever races the null case.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/messages',
        prepareSendMessagesRequest: ({ messages }) => {
          const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
          return {
            body: {
              external_user_id: userId ?? 'anonymous',
              message: { text: lastUserMessage ? textOf(lastUserMessage) : '' },
            },
          };
        },
      }),
    [userId],
  );

  const { messages, setMessages, sendMessage, status, error } = useChat({ transport });
  const isLoading = status === 'submitted' || status === 'streaming';

  // Reload persistence: once userId is known, fetch this page's own history
  // for it (see app/api/history/route.ts) and hydrate the chat — otherwise a
  // refresh shows a blank chat even though external_user_id would continue
  // the same Studio thread on the next message.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/history?external_user_id=${encodeURIComponent(userId)}`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data: { messages?: StoredMessage[] }) => {
        if (cancelled || !data.messages?.length) return;
        setMessages(data.messages.map(toUIMessage));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, setMessages]);

  // Persist the assistant's reply once a turn finishes streaming — the
  // server never sees the fully-assembled text in streaming mode, so the
  // client (which does) reports it back for next time.
  const prevStatusRef = useRef(status);
  const lastPersistedAssistantIdRef = useRef<string | null>(null);
  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'submitted' || prevStatusRef.current === 'streaming';
    prevStatusRef.current = status;
    if (!wasStreaming || status !== 'ready' || !userId) return;
    const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistantMessage || lastPersistedAssistantIdRef.current === lastAssistantMessage.id) return;
    lastPersistedAssistantIdRef.current = lastAssistantMessage.id;
    persistMessage(userId, 'assistant', textOf(lastAssistantMessage));
  }, [status, messages, userId]);

  const [input, setInput] = useState('');
  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || !userId || isLoading) return;
      setInput('');
      persistMessage(userId, 'user', text);
      sendMessage({ text });
    },
    [input, userId, isLoading, sendMessage],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col rounded-lg border"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="border-b px-4 py-3 font-medium" style={{ borderColor: 'var(--border)' }}>
        Try it
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Say hello to start the conversation.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === 'user' ? 'ml-auto max-w-[80%]' : 'mr-auto max-w-[80%]'
            }
          >
            <div
              className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
              style={
                message.role === 'user'
                  ? { background: 'var(--bubble-user)', color: 'var(--bubble-user-fg)' }
                  : { background: 'var(--bubble-assistant)' }
              }
            >
              {textOf(message)}
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p className="px-4 pb-2 text-sm text-red-500">Something went wrong — please try again.</p>
      )}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 border-t p-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={!userId || isLoading}
          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none disabled:opacity-50"
          style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
        />
        <button
          type="submit"
          disabled={!userId || isLoading || !input.trim()}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--bubble-user)', color: 'var(--bubble-user-fg)' }}
        >
          {isLoading ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
