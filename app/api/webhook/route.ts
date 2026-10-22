import { NextRequest, NextResponse } from 'next/server';

/**
 * Test-only receiver for Studio's "Web-based Chat" channel outbound sends
 * (the chat-lifecycle follow-up nudge posts here as { thread_id, message: { text } }).
 * Not part of the integration pattern — only exists to manually verify
 * Studio's SSRF guard / timeout / non-OK-throw behavior on webbasePlugin.send().
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  console.log('[webhook] received:', body);
  return NextResponse.json({ ok: true });
}
