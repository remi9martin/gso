import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { type NextRequest } from 'next/server';

import { checkMemoryMcpAuth } from '@/lib/memory-mcp/auth';
import { buildMemoryMcpServer } from '@/lib/memory-mcp/server';
import { readUpstreamConfigFromEnv, UpstreamError } from '@/lib/memory-mcp/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest): Promise<Response> {
  const auth = checkMemoryMcpAuth(req.headers);
  if (!auth.ok) {
    return Response.json(
      { error: auth.error, message: auth.message },
      { status: auth.status, headers: { 'WWW-Authenticate': 'Bearer' } }
    );
  }

  let config;
  try {
    config = readUpstreamConfigFromEnv();
  } catch (err) {
    if (err instanceof UpstreamError) {
      return Response.json(
        { error: 'upstream_misconfigured', message: err.message },
        { status: err.status }
      );
    }
    throw err;
  }

  const server = buildMemoryMcpServer(config);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
