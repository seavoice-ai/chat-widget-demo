import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendMessage, getMessages } from '@/lib/message-store';

/**
 * Demo-only history endpoint — reload persistence for THIS page, not part of
 * the integration pattern shown in the code panel. See lib/message-store.ts.
 */

const MAX_TEXT_LENGTH = 2000;

const postBodySchema = z.object({
  external_user_id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const externalUserId = request.nextUrl.searchParams.get('external_user_id');
  if (!externalUserId) {
    return NextResponse.json({ error: 'external_user_id is required' }, { status: 400 });
  }
  return NextResponse.json({ messages: getMessages(externalUserId) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }
  const parsed = postBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { external_user_id: externalUserId, role, text } = parsed.data;
  const message = appendMessage(externalUserId, role, text);
  return NextResponse.json({ message });
}
