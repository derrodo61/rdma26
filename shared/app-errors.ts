import type { SkillCompatibilityReport } from './agent-contracts';

export type AppErrorCode =
  | 'REQUEST_FAILED'
  | 'SKILL_ARCHIVE_NOT_FOUND'
  | 'SKILL_ARCHIVE_NOT_READABLE'
  | 'SKILL_ARCHIVE_TOO_LARGE'
  | 'SKILL_ARCHIVE_UNSUPPORTED_TYPE'
  | 'SKILL_ARCHIVE_NOT_USABLE'
  | 'SKILL_PACKAGE_INVALID'
  | 'SKILL_PACKAGE_UNSAFE'
  | 'SKILL_SOURCE_NOT_FOUND'
  | 'SKILL_SOURCE_NOT_READABLE'
  | 'SKILL_SOURCE_NOT_USABLE';

export type AppErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

export interface AppErrorResponse {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly details?: AppErrorDetails;
  readonly compatibility?: SkillCompatibilityReport;
}

export function appErrorMessage(code: AppErrorCode, details: AppErrorDetails = {}): string {
  switch (code) {
    case 'REQUEST_FAILED':
      return 'Request failed.';
    case 'SKILL_SOURCE_NOT_FOUND':
      return withPath('Skill directory does not exist.', details);
    case 'SKILL_SOURCE_NOT_READABLE':
      return withPath('Skill directory cannot be read.', details);
    case 'SKILL_SOURCE_NOT_USABLE':
      return withPath('Local skill source must be a normal directory.', details);
    case 'SKILL_ARCHIVE_NOT_FOUND':
      return withPath('Skill archive does not exist.', details);
    case 'SKILL_ARCHIVE_NOT_READABLE':
      return withPath('Skill archive cannot be read.', details);
    case 'SKILL_ARCHIVE_NOT_USABLE':
      return withPath('Skill archive source must be a normal ZIP file.', details);
    case 'SKILL_ARCHIVE_TOO_LARGE':
      return withLimit('Skill archive is too large.', details);
    case 'SKILL_ARCHIVE_UNSUPPORTED_TYPE':
      return withPath('Only ZIP skill archives are supported.', details);
    case 'SKILL_PACKAGE_INVALID':
      return 'The skill package is invalid.';
    case 'SKILL_PACKAGE_UNSAFE':
      return 'The skill package failed safety validation.';
  }
}

export function formatAppErrorResponse(error: AppErrorResponse): string {
  const findings = error.compatibility?.findings ?? [];
  const usefulFindings = findings
    .filter((finding) => finding.severity === 'error' || finding.severity === 'warning')
    .slice(0, 4)
    .map((finding) => (finding.path ? `${finding.path}: ${finding.message}` : finding.message));

  if (usefulFindings.length) {
    return `${error.message}\n${usefulFindings.join('\n')}`;
  }

  return error.message;
}

function withPath(message: string, details: AppErrorDetails): string {
  const path = details['path'];
  return typeof path === 'string' && path ? `${message.replace(/\.$/, '')}: ${path}` : message;
}

function withLimit(message: string, details: AppErrorDetails): string {
  const limitBytes = details['limitBytes'];
  return typeof limitBytes === 'number' ? `${message} Limit is ${limitBytes} bytes.` : message;
}
