import { NextRequest, NextResponse } from 'next/server';
import { verifyStudioWebhook } from '@/lib/studio-signing';
import { appendMessage } from '@/lib/message-store';

/**
 * Receiver for Studio's Web Chat follow-up check-ins — a signed POST Studio
 * sends to this URL when a conversation goes quiet (`kind: "follow_up"`) or
 * the agent failed to answer in time (`kind: "recovered_reply"`). This is
 * the one piece of the integration pattern that ISN'T a request this demo
 * initiates: Studio calls in, unprompted, whenever the channel has a
 * webhook URL configured and the conversation turned `follow_up` on.
 *
 * Verifies the signature with the channel's webhook secret (a DIFFERENT
 * secret from the one app/api/messages/route.ts signs outbound calls
 * with — see the code panel's explanation), skips a webhook-id already
 * seen, and — purely so this demo is visibly useful — appends the
 * follow-up into this page's own history store so it shows up if you
 * reload while a check-in is waiting.
 */

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
  const webhookSecret = process.env.STUDIO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[webhook] Missing STUDIO_WEBHOOK_SECRET — cannot verify incoming follow-ups');
    return NextResponse.json({ error: 'Webhook receiver is not configured.' }, { status: 500 });
  }

  const rawBody = await request.text();
  if (!verifyStudioWebhook(request.headers, rawBody, webhookSecret)) {
    console.warn('[webhook] rejected a delivery with an invalid or missing signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const webhookId = request.headers.get('webhook-id')!; // verifyStudioWebhook already required it
  if (seenWebhookIds.has(webhookId)) {
    console.log('[webhook] skipping an already-handled webhook-id:', webhookId);
    return NextResponse.json({ ok: true });
  }
  rememberWebhookId(webhookId);

  let body: { external_user_id?: string; message?: { id?: string; kind?: string; text?: string } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  console.log('[webhook] received a', body.message?.kind, 'for', body.external_user_id, ':', body.message?.text);

  // Answer 2xx fast, as the guide asks — this demo does its "slow work"
  // (persisting so a reload shows it) inline since it's already instant.
  if (body.external_user_id && body.message?.text) {
    appendMessage(body.external_user_id, 'assistant', body.message.text);
  }

  return NextResponse.json({ ok: true });
}
