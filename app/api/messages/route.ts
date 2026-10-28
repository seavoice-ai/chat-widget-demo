import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { signStudioRequest } from '@/lib/studio-signing';

/**
 * Backend for the chat widget demo.
 *
 * This is deliberately the ONLY code a customer needs to copy to stand up
 * their own chat backend: it holds the channel's real API secret
 * server-side and forwards the browser's message to Studio's signed Web
 * Chat API (`/api/external/{version}/chat/web/{channel_id}/messages`) —
 * the browser never sees the secret.
 *
 * Nothing here turns check-ins on or off: Studio sends them to the channel's
 * Follow-up Callback URL (app/api/callback/route.ts), when it has one, while
 * the agent's own Enable Follow-Up setting is on. The request's old
 * `follow_up` field is gone — Studio ignores it.
 */

const STUDIO_API_VERSION = '2026-07';
const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

const bodySchema = z.object({
  external_user_id: z.string().min(1).max(200),
  message: z.object({ text: z.string().min(1).max(MAX_MESSAGE_LENGTH) }),
});

// In-memory per-IP token bucket. Process-local, so it only throttles a single
// server instance and resets on restart — acceptable for a demo, not a
// guarantee across multiple instances. Cleared lazily on each request rather
// than on a timer.
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(ip) ?? []).filter((t) => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return false;
}

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const studioBaseUrl = process.env.STUDIO_BASE_URL;
  const channelId = process.env.STUDIO_CHANNEL_ID;
  const apiSecret = process.env.STUDIO_API_SECRET;
  if (!studioBaseUrl || !channelId || !apiSecret) {
    console.error('[chat-widget-demo] Missing STUDIO_BASE_URL / STUDIO_CHANNEL_ID / STUDIO_API_SECRET');
    return NextResponse.json({ error: 'Chat demo is not configured.' }, { status: 500 });
  }

  const ip = clientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many messages — please slow down.' }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { external_user_id: externalUserId, message } = parsed.data;

  // The channel decides which agent answers — no assistant_id needed. Sign
  // the EXACT string we're about to send; the body must be byte-identical
  // to what was signed, or Studio's signature check fails.
  //
  // For a signed-in user, also send `name` (Chat Logs' Customer Name) and
  // `client_customer_id` (links the thread to the Studio customer with that
  // Client Customer ID, whose data then reaches the agent) — both optional,
  // at most 200 characters. Take them from YOUR session, never from the
  // browser's request body: a visitor who could set client_customer_id
  // could pull another customer's data into the agent's replies. This
  // demo's visitors are anonymous, so it sends neither.
  const body = JSON.stringify({ external_user_id: externalUserId, message });
  const signedHeaders = signStudioRequest(apiSecret, body);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${studioBaseUrl}/api/external/${STUDIO_API_VERSION}/chat/web/${channelId}/messages?stream=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...signedHeaders },
        body,
      },
    );
  } catch (error) {
    console.error('[chat-widget-demo] Failed to reach Studio', error);
    return NextResponse.json({ error: 'Could not reach the chat service — please try again.' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    console.error('[chat-widget-demo] Studio returned an error, status', upstream.status);
    return NextResponse.json({ error: 'The chat service returned an error — please try again.' }, { status: 502 });
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers: upstream.headers });
}
