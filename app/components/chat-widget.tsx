'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

const SESSION_STORAGE_KEY = 'chat-demo-user-id';
const FIRST_MESSAGE_TIMEOUT_MS = 10_000;

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

/** One chat bubble per step that said something — the same split Studio
 *  stores and returns as `replies`. An agent that looks something up says so
 *  first ("Let me check that for you"), then answers in a later step, and
 *  both arrive in ONE streamed UI message with a `step-start` part between
 *  them; joining every text part would run the two together. */
function bubblesOf(message: UIMessage): string[] {
  const bubbles: string[] = [];
  let current = '';
  for (const part of message.parts) {
    if (part.type === 'step-start') {
      if (current.trim()) bubbles.push(current);
      current = '';
    } else if (part.type === 'text') {
      current += part.text;
    }
  }
  if (current.trim()) bubbles.push(current);
  return bubbles;
}

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

function toUIMessage(stored: StoredMessage): UIMessage {
  return { id: stored.id, role: stored.role, parts: [{ type: 'text', text: stored.text }] };
}

/** The agent's First Message, asked for when the widget opens: empty when the
 *  agent has none. A greeting isn't worth holding the widget up for, so any
 *  failure, or a slow answer, just opens it without one. */
async function fetchFirstMessage(): Promise<string[]> {
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'first_message' }),
      signal: AbortSignal.timeout(FIRST_MESSAGE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data: { replies?: { text: string }[] } = await res.json();
    return (data.replies ?? []).map((reply) => reply.text);
  } catch {
    return [];
  }
}

async function fetchHistory(externalUserId: string): Promise<StoredMessage[]> {
  try {
    const res = await fetch(`/api/history?external_user_id=${encodeURIComponent(externalUserId)}`);
    if (!res.ok) return [];
    const data: { messages?: StoredMessage[] } = await res.json();
    return data.messages ?? [];
  } catch {
    return [];
  }
}

/** Demo-only: persists one message to this page's own history store (see
 *  app/api/history/route.ts) so a reload can restore the conversation. Not
 *  part of the integration pattern in the code panel — best-effort, fire and
 *  forget. */
function persistMessage(externalUserId: string, role: StoredMessage['role'], text: string): Promise<void> {
  if (!text.trim()) return Promise.resolve();
  return fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ external_user_id: externalUserId, role, text }),
  }).then(
    () => {},
    () => {},
  );
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

  // Greeting not yet part of the conversation: kept here until the visitor
  // writes. Studio stores it at that same moment, as the first message of the
  // new thread, so a visitor who never writes leaves nothing behind.
  const unsavedGreetingRef = useRef<string[]>([]);

  // Opening the chat: once userId is known, restore this page's own history
  // for it (see app/api/history/route.ts) — otherwise a refresh shows a blank
  // chat even though external_user_id would continue the same Studio thread on
  // the next message. A conversation with no history starts with the agent's
  // First Message instead; one that's already going doesn't get greeted again.
  // The input stays disabled until this is done, so setMessages here can't
  // overwrite something the visitor just sent.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const history = await fetchHistory(userId);
      if (cancelled) return;
      if (history.length > 0) {
        setMessages(history.map(toUIMessage));
      } else {
        const greeting = await fetchFirstMessage();
        if (cancelled) return;
        unsavedGreetingRef.current = greeting;
        setMessages(greeting.map((text, i) => toUIMessage({ id: `first-message-${i}`, role: 'assistant', text })));
      }
      setOpened(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, setMessages]);

  // One save at a time, so a reload shows the messages in the order they were
  // said even when several go out together.
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistInOrder = useCallback((externalUserId: string, role: StoredMessage['role'], text: string) => {
    persistQueueRef.current = persistQueueRef.current.then(() => persistMessage(externalUserId, role, text));
  }, []);

  // Persist the assistant's reply once a turn finishes streaming — the
  // server never sees the fully-assembled text in streaming mode, so the
  // client (which does) reports it back for next time. One stored message
  // per bubble. The reply is the last message: a turn that said nothing leaves
  // the visitor's message last, and there's nothing new to save.
  const prevStatusRef = useRef(status);
  const lastPersistedAssistantIdRef = useRef<string | null>(null);
  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'submitted' || prevStatusRef.current === 'streaming';
    prevStatusRef.current = status;
    if (!wasStreaming || status !== 'ready' || !userId) return;
    const reply = messages.at(-1);
    if (reply?.role !== 'assistant' || lastPersistedAssistantIdRef.current === reply.id) return;
    lastPersistedAssistantIdRef.current = reply.id;
    for (const text of bubblesOf(reply)) persistInOrder(userId, 'assistant', text);
  }, [status, messages, userId, persistInOrder]);

  const [input, setInput] = useState('');
  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || !userId || !opened || isLoading) return;
      setInput('');
      for (const greeting of unsavedGreetingRef.current) persistInOrder(userId, 'assistant', greeting);
      unsavedGreetingRef.current = [];
      persistInOrder(userId, 'user', text);
      sendMessage({ text });
    },
    [input, userId, opened, isLoading, sendMessage, persistInOrder],
  );

  // A fresh external_user_id means a fresh Studio thread on the next message
  // (resolveOrCreateThread finds nothing for the new id) — the old
  // conversation isn't deleted, just no longer the one this tab is on. The
  // opening effect above runs again for the new id, so it gets greeted too.
  const handleNewChat = useCallback(() => {
    if (isLoading) return;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    setUserId(created);
    setMessages([]);
    setInput('');
    setOpened(false);
    unsavedGreetingRef.current = [];
    prevStatusRef.current = 'ready';
    lastPersistedAssistantIdRef.current = null;
  }, [isLoading, setMessages]);

  return (
    <div
      className="flex h-full min-h-0 flex-col rounded-lg border"
      style={{ borderColor: 'var(--border)' }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="font-medium">Try it</span>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={!userId || isLoading}
          className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          New chat
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {opened && messages.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Say hello to start the conversation.
          </p>
        )}
        {messages.flatMap((message) =>
          bubblesOf(message).map((text, i) => (
            <div
              key={`${message.id}-${i}`}
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
                {text}
              </div>
            </div>
          )),
        )}
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
          disabled={!opened || isLoading}
          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none disabled:opacity-50"
          style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
        />
        <button
          type="submit"
          disabled={!opened || isLoading || !input.trim()}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--bubble-user)', color: 'var(--bubble-user-fg)' }}
        >
          {isLoading ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
