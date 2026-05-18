export interface HealthPayload {
  status: 'ok';
  service: 'gso';
  version: string;
  commit: string;
  uptimeSeconds: number;
  timestamp: string;
}

const startedAt = Date.now();

function resolveCommit(): string {
  const raw =
    process.env.GSO_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;
  if (!raw) return 'dev';
  return raw.slice(0, 7);
}

export function buildHealthPayload(now: () => number = Date.now): HealthPayload {
  const current = now();
  return {
    status: 'ok',
    service: 'gso',
    version: process.env.GSO_VERSION ?? '0.0.0',
    commit: resolveCommit(),
    uptimeSeconds: Math.max(0, Math.round((current - startedAt) / 1000)),
    timestamp: new Date(current).toISOString()
  };
}
