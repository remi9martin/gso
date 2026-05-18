import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { handleMemoryRead, handleMemoryWrite, type ToolCallResult } from './tools';
import type { UpstreamConfig } from './upstream';

const SERVER_INFO = {
  name: 'gso-memory-mcp',
  version: '0.1.0'
} as const;

export function buildMemoryMcpServer(config: UpstreamConfig): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'memory_read',
    {
      title: 'Read communal memory',
      description:
        'Reads a Tier-3 entry from the GSO communal memory store at the given path. ' +
        'Paths mirror the deploy-memory layout (e.g. "identity/who-is-remi.md").',
      inputSchema: {
        path: z.string().min(1).describe('Memory path, relative to the store root.')
      }
    },
    async (args: { path: string }) => toCallToolResult(await handleMemoryRead(config, args))
  );

  server.registerTool(
    'memory_write',
    {
      title: 'Write communal memory',
      description:
        'Upserts a Tier-3 entry into the GSO communal memory store. ' +
        'Tier 2 (encrypted) is out of scope for v0.',
      inputSchema: {
        path: z.string().min(1).describe('Memory path, relative to the store root.'),
        content: z.string().describe('UTF-8 content to store. Max 2 MiB.'),
        tier: z.literal('tier3').optional().describe('Storage tier. Only "tier3" is supported.')
      }
    },
    async (args: { path: string; content: string; tier?: 'tier3' }) =>
      toCallToolResult(await handleMemoryWrite(config, args))
  );

  return server;
}

function toCallToolResult(result: ToolCallResult): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  if (!result.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: result.message }]
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }]
  };
}
