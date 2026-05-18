import { NextResponse } from 'next/server';

import { loadCanvas } from '@/lib/canvas/loader';
import { PaperclipApiError } from '@/lib/paperclip/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { bundle, source, mode, missingEnv } = await loadCanvas();
    return NextResponse.json(bundle, {
      headers: {
        'Cache-Control': 'no-store',
        'X-GSO-Canvas-Cache': source,
        'X-GSO-Canvas-Mode': mode,
        ...(missingEnv ? { 'X-GSO-Canvas-Missing-Env': missingEnv.join(',') } : {})
      }
    });
  } catch (err) {
    if (err instanceof PaperclipApiError) {
      return NextResponse.json(
        {
          error: 'paperclip_api_error',
          upstreamStatus: err.status,
          endpoint: err.endpoint,
          message: err.message
        },
        { status: 502 }
      );
    }
    console.error('[gso] /api/canvas failed', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Canvas load failed' },
      { status: 500 }
    );
  }
}
