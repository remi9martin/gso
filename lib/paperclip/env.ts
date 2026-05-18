import 'server-only';

export interface PaperclipEnv {
  apiUrl: string;
  apiKey: string;
  companyId: string;
}

export class PaperclipEnvError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing required Paperclip environment variables: ${missing.join(', ')}. ` +
        `Set these in your deployment env (see .env.example).`
    );
    this.name = 'PaperclipEnvError';
  }
}

export function readPaperclipEnv(
  source: Record<string, string | undefined> = process.env
): PaperclipEnv {
  const apiUrl = source.PAPERCLIP_API_URL?.trim();
  const apiKey = source.PAPERCLIP_API_KEY?.trim();
  const companyId = source.PAPERCLIP_COMPANY_ID?.trim();

  const missing: string[] = [];
  if (!apiUrl) missing.push('PAPERCLIP_API_URL');
  if (!apiKey) missing.push('PAPERCLIP_API_KEY');
  if (!companyId) missing.push('PAPERCLIP_COMPANY_ID');

  if (missing.length > 0) throw new PaperclipEnvError(missing);

  return {
    apiUrl: apiUrl!.replace(/\/+$/, ''),
    apiKey: apiKey!,
    companyId: companyId!
  };
}
