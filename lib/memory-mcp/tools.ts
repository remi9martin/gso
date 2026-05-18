import { validateMemoryPath } from './path';
import {
  upstreamRead,
  upstreamWrite,
  UpstreamError,
  type UpstreamConfig,
  type UpstreamReadResult,
  type UpstreamWriteResult
} from './upstream';

export type ToolCallResult =
  | { ok: true; data: UpstreamReadResult | UpstreamWriteResult }
  | { ok: false; message: string };

export async function handleMemoryRead(
  config: UpstreamConfig,
  args: { path: unknown }
): Promise<ToolCallResult> {
  const pathCheck = validateMemoryPath(args.path);
  if (!pathCheck.ok) {
    return { ok: false, message: pathCheck.message };
  }
  try {
    const data = await upstreamRead(config, pathCheck.path);
    return { ok: true, data };
  } catch (err) {
    return errorToResult(err);
  }
}

export async function handleMemoryWrite(
  config: UpstreamConfig,
  args: { path: unknown; content: unknown; tier?: unknown }
): Promise<ToolCallResult> {
  const pathCheck = validateMemoryPath(args.path);
  if (!pathCheck.ok) {
    return { ok: false, message: pathCheck.message };
  }
  if (typeof args.content !== 'string') {
    return { ok: false, message: 'content must be a string' };
  }
  if (args.content.length > 2 * 1024 * 1024) {
    return { ok: false, message: 'content exceeds 2 MiB upstream limit' };
  }
  const tier = args.tier ?? 'tier3';
  if (tier !== 'tier3') {
    return {
      ok: false,
      message: 'tier must be "tier3" (Tier 2 encrypted writes are not implemented)'
    };
  }
  try {
    const data = await upstreamWrite(config, pathCheck.path, args.content, 'tier3');
    return { ok: true, data };
  } catch (err) {
    return errorToResult(err);
  }
}

function errorToResult(err: unknown): ToolCallResult {
  if (err instanceof UpstreamError) {
    return { ok: false, message: `Upstream error (${err.status}): ${err.message}` };
  }
  return { ok: false, message: `Unexpected error: ${(err as Error).message}` };
}
