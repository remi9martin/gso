import { NextRequest, NextResponse } from 'next/server';

import { readBurnSeries } from '@/lib/canvas/burn-snapshot/series-cache';
import { loadBurnSeries } from '@/lib/canvas/burn-snapshot/series';
import { getBurnSnapshotStore } from '@/lib/canvas/burn-snapshot/store-singleton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get('agentId');
  if (!agentId) {
    return NextResponse.json({ error: 'agentId_required' }, { status: 400 });
  }

  try {
    const store = getBurnSnapshotStore();
    const { series, source } = await readBurnSeries(agentId, () => loadBurnSeries(store, agentId));
    return NextResponse.json(series, {
      headers: {
        'Cache-Control': 'no-store',
        'X-GSO-Burn-Cache': source
      }
    });
  } catch (err) {
    console.error('[gso] /api/canvas/burn failed', err);
    return NextResponse.json(
      { error: 'internal_error', message: 'Burn series load failed' },
      {
        status: 500
      }
    );
  }
}
