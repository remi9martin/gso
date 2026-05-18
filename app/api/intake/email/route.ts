import { NextRequest } from 'next/server';

import { handleEmailIntake } from '@/lib/intake/email-handler';
import { getIntakeNormalizer, getIntakePayloadStore } from '@/lib/intake/store-singleton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  return handleEmailIntake(request, {
    payloadStore: getIntakePayloadStore(),
    normalizer: getIntakeNormalizer()
  });
}
