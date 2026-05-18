import { NextRequest } from 'next/server';

import { handleIntakeRequest, loadIntakeConfigOr503 } from '@/lib/intake/handler';
import {
  getIntakeNormalizer,
  getIntakePayloadStore,
  getIntakeTokenStore
} from '@/lib/intake/store-singleton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const configOrResponse = loadIntakeConfigOr503();
  if (configOrResponse instanceof Response) return configOrResponse;

  return handleIntakeRequest(request, {
    payloadStore: getIntakePayloadStore(),
    tokenStore: getIntakeTokenStore(),
    normalizer: getIntakeNormalizer(),
    config: configOrResponse
  });
}
