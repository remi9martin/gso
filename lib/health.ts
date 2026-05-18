export interface HealthPayload {
  status: 'ok';
  service: 'gso';
  version: string;
  commit: string;
  uptimeSeconds: number;
  timestamp: string;
}

const startedAt = Date.now();

export function buildHealthPayload(now: () => number = Date.now): HealthPayload {
  const current = now();
  return {
    status: 'ok',
    service: 'gso',
    version: process.env.GSO_VERSION ?? '0.0.0',
    commit: process.env.GSO_COMMIT ?? 'dev',
    uptimeSeconds: Math.max(0, Math.round((current - startedAt) / 1000)),
    timestamp: new Date(current).toISOString()
  };
}
