/**
 * Demo-only conversation history, keyed by `external_user_id`.
 *
 * This is bookkeeping for THIS demo page (so a reload shows the same
 * conversation instead of a blank chat) — it is not part of the
 * backend/frontend pattern shown in the code panel, and a customer doesn't
 * need anything like it to integrate chat. Studio's own external chat API
 * has no "look up a thread by external_user_id" endpoint (only by
 * thread_id, which isn't available in streaming mode), so this demo keeps
 * its own copy instead.
 *
 * In-memory and process-local: resets on restart, not shared across
 * multiple server instances — fine for a demo, not a real store.
 */

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

const MAX_MESSAGES_PER_USER = 200;

const store = new Map<string, StoredMessage[]>();

export function appendMessage(externalUserId: string, role: StoredMessage['role'], text: string): StoredMessage {
  const message: StoredMessage = { id: crypto.randomUUID(), role, text, createdAt: Date.now() };
  const existing = store.get(externalUserId) ?? [];
  existing.push(message);
  if (existing.length > MAX_MESSAGES_PER_USER) {
    existing.splice(0, existing.length - MAX_MESSAGES_PER_USER);
  }
  store.set(externalUserId, existing);
  return message;
}

export function getMessages(externalUserId: string): StoredMessage[] {
  return store.get(externalUserId) ?? [];
}
