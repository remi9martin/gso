import { NextRequest, NextResponse } from 'next/server';

import { readPaperclipEnv, PaperclipEnvError } from '@/lib/paperclip/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  let env;
  try {
    env = readPaperclipEnv();
  } catch (err) {
    if (err instanceof PaperclipEnvError) {
      return NextResponse.json({ error: 'paperclip_env_missing' }, { status: 503 });
    }
    throw err;
  }

  const upstream = await fetch(`${env.apiUrl}/api/issues/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${env.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body),
    cache: 'no-store'
  });

  const data = await upstream.json().catch(() => null);
  return NextResponse.json(data ?? {}, { status: upstream.status });
}
