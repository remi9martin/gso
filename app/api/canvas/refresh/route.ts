import { NextResponse, type NextRequest } from 'next/server';

import { invalidateCanvasCache } from '@/lib/canvas/cache';
import { checkRefreshAuth } from '@/lib/canvas/refresh-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = checkRefreshAuth(req.headers);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, message: auth.message }, { status: auth.status });
  }

  invalidateCanvasCache();
  return NextResponse.json(
    { ok: true, invalidatedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
