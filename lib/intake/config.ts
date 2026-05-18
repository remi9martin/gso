import 'server-only';

// Single source of truth for environment-derived intake settings. The route
// handler and the UI server action both pull from here so they agree on the
// project id and the user that owns Draft issues.

export interface IntakeRuntimeConfig {
  projectId: string;
  assigneeUserId: string;
  uiUserId: string;
}

export class IntakeConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing required intake environment variables: ${missing.join(', ')}. ` + `See .env.example.`
    );
    this.name = 'IntakeConfigError';
  }
}

export function readIntakeConfig(
  source: Record<string, string | undefined> = process.env
): IntakeRuntimeConfig {
  const projectId = source.GSO_INTAKE_PROJECT_ID?.trim();
  const assigneeUserId = source.GSO_INTAKE_ASSIGNEE_USER_ID?.trim();
  const uiUserId = source.GSO_INTAKE_UI_USER_ID?.trim() ?? assigneeUserId;

  const missing: string[] = [];
  if (!projectId) missing.push('GSO_INTAKE_PROJECT_ID');
  if (!assigneeUserId) missing.push('GSO_INTAKE_ASSIGNEE_USER_ID');

  if (missing.length > 0) throw new IntakeConfigError(missing);

  return {
    projectId: projectId!,
    assigneeUserId: assigneeUserId!,
    uiUserId: uiUserId!
  };
}
