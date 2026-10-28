import { NextRequest, NextResponse } from 'next/server';
import { verifyStudioCallback } from '@/lib/studio-signing';
import { appendMessage } from '@/lib/message-store';

/**
 * Receiver for Studio's Web Chat follow-ups — the channel's Follow-up
 * Callback URL. Studio sends a signed POST here when a conversation goes
 * quiet (`kind: "follow_up"`) or the agent failed to answer in time
 * (`kind: "recovered_reply"`). This is the one piece of the integration
 * pattern that ISN'T a request this demo initiates: Studio calls in,
 * unprompted, whenever the channel has a callback URL — a check-in only
 * while the agent's Enable Follow-Up setting is on, a late answer either way.
 *
 * Verifies the signature with the channel's callback secret (a DIFFERENT
 * secret from the API secret app/api/messages/route.ts signs outbound calls
 * with — see the README's "Two secrets, two directions"), skips a
 * webhook-id already seen, and — purely so this demo is visibly useful —
 * appends the follow-up into this page's own history store so it shows up
 * if you reload while a check-in is waiting.
 */

interface StudioCallbackBody {
  version?: string;
  thread_id?: string;
  external_user_id?: string;
  message?: { id?: string; kind?: 'follow_up' | 'recovered_reply'; text?: string };
}

// Same idempotency idea as Studio's own `webhook-id` dedupe: in-memory,
// process-local, bounded — fine for a demo, not a real store.
const seenWebhookIds = new Set<string>();
const MAX_SEEN_IDS = 500;

function rememberWebhookId(id: string): void {
  seenWebhookIds.add(id);
  if (seenWebhookIds.size > MAX_SEEN_IDS) {
    const oldest = seenWebhookIds.values().next().value;
    if (oldest) seenWebhookIds.delete(oldest);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const callbackSecret = process.env.STUDIO_CALLBACK_SECRET;
  if (!callbackSecret) {
    console.error('[callback] Missing STUDIO_CALLBACK_SECRET — cannot verify incoming follow-ups');
    return NextResponse.json({ error: 'Callback receiver is not configured.' }, { status: 500 });
  }

  const rawBody = await request.text();
  if (!verifyStudioCallback(request.headers, rawBody, callbackSecret)) {
    console.warn('[callback] rejected a delivery with an invalid or missing signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const webhookId = request.headers.get('webhook-id')!; // verifyStudioCallback already required it
  if (seenWebhookIds.has(webhookId)) {
    console.log('[callback] skipping an already-handled webhook-id:', webhookId);
    return NextResponse.json({ ok: true });
  }
  rememberWebhookId(webhookId);

  let body: StudioCallbackBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  console.log(
    '[callback] received a', body.message?.kind, 'for', body.external_user_id,
    'on thread', body.thread_id, ':', body.message?.text,
  );

  // Answer 2xx fast, as the guide asks — this demo does its "slow work"
  // (persisting so a reload shows it) inline since it's already instant.
  if (body.external_user_id && body.message?.text) {
    appendMessage(body.external_user_id, 'assistant', body.message.text);
  }

  return NextResponse.json({ ok: true });
}
