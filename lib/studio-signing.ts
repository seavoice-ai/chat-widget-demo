import crypto from 'node:crypto';

/**
 * Standard Webhooks signing for Studio's signed web chat API
 * (`chat/web/{channel_id}/*`), and verification for the follow-up check-ins
 * Studio posts back to this demo's own webhook receiver. Mirrors the
 * snippets in Studio's own customer guide
 * (`docs-site/content/integrations/web-chat.mdx` in the Studio repo) — keep
 * these two functions in sync with that page if the scheme ever changes.
 */

export interface SignedHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

const MAX_SKEW_SECONDS = 300;

function keyFromSecret(secret: string): Buffer {
  return secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret, 'utf8');
}

/** Sign a request TO Studio, with the channel's API secret. `payload` is the
 *  exact request body string for a POST, or the request path plus query
 *  string for a GET (there's no body on a GET). */
export function signStudioRequest(apiSecret: string, payload: string, id = crypto.randomUUID()): SignedHeaders {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = keyFromSecret(apiSecret);
  const signature = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  };
}

/** Verify a follow-up Studio sent FROM Studio, with the channel's webhook
 *  secret — this demo's own webhook receiver (app/api/webhook/route.ts)
 *  calls this before trusting a delivery. */
export function verifyStudioWebhook(
  headers: { get(name: string): string | null },
  rawBody: string,
  webhookSecret: string,
): boolean {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');
  if (!id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;

  const key = keyFromSecret(webhookSecret);
  const expected = Buffer.from(
    crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64'),
  );

  return signatures.split(' ').some((entry) => {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}
