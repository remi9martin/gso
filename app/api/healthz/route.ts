import { NextResponse } from 'next/server';
import { buildHealthPayload } from '@/lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(buildHealthPayload(), {
    headers: { 'Cache-Control': 'no-store' }
  });
}
