import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';

import type {
  SkillCompatibilityFinding,
  SkillCompatibilityReport,
  SkillInstalledVersion,
} from '../../../shared/agent-contracts';
import {
  hashDirectory,
  listFiles,
  readSkillPackage,
  type SkillPackageDefinition,
} from './skill-library';

const maxFiles = 200;
const maxFileBytes = 5 * 1024 * 1024;
const maxPackageBytes = 50 * 1024 * 1024;
const scriptExtensions = new Set([
  '.bash',
  '.cjs',
  '.js',
  '.mjs',
  '.ps1',
  '.psd1',
  '.psm1',
  '.py',
  '.sh',
  '.ts',
  '.zsh',
]);
const binaryAssetExtensions = new Set(['.gif', '.jpeg', '.jpg', '.pdf', '.png', '.webp']);
const blockedExtensions = new Set([
  '.app',
  '.bin',
  '.class',
  '.com',
  '.dll',
  '.dmg',
  '.dylib',
  '.exe',
  '.msi',
  '.node',
  '.o',
  '.so',
]);

export interface ScannedSkillPackage {
  readonly definition: SkillPackageDefinition;
  readonly contentHash: string;
  readonly author?: string;
  readonly license?: string;
  readonly version?: string;
  readonly compatibility: SkillCompatibilityReport;
}

export class SkillPackageValidationError extends Error {
  constructor(
    message: string,
    readonly report: SkillCompatibilityReport,
  ) {
    super(message);
    this.name = 'SkillPackageValidationError';
  }
}

export async function scanSkillPackage(
  directory: string,
  enabledCapabilities: readonly string[] = [],
  expectedName = basename(directory),
): Promise<ScannedSkillPackage> {
  let definition: SkillPackageDefinition;

  try {
    definition = await readSkillPackage(directory, 'external', expectedName);
  } catch (error) {
    const report = unsafeReport([
      finding('invalid_package', 'error', error instanceof Error ? error.message : String(error)),
    ]);
    throw new SkillPackageValidationError('The skill package is invalid.', report);
  }

  const files = await listFiles(directory);
  const findings: SkillCompatibilityFinding[] = [];
  let totalBytes = 0;
  let hasScripts = false;
  let combinedText = '';

  if (files.length > maxFiles) {
    findings.push(
      finding(
        'package_file_limit',
        'error',
        `Package has ${files.length} files; maximum is ${maxFiles}.`,
      ),
    );
  }

  for (const filePath of files) {
    const path = portableRelativePath(directory, filePath);
    const info = await stat(filePath);
    totalBytes += info.size;

    if (info.size > maxFileBytes) {
      findings.push(
        finding(
          'file_size_limit',
          'error',
          `${path} exceeds the ${maxFileBytes}-byte file limit.`,
          path,
        ),
      );
      continue;
    }

    const extension = extname(filePath).toLowerCase();

    if (blockedExtensions.has(extension)) {
      findings.push(
        finding('executable_binary', 'error', `${path} is an executable binary type.`, path),
      );
      continue;
    }

    if (scriptExtensions.has(extension) || (info.mode & 0o111) !== 0) {
      hasScripts = true;
      findings.push(
        finding(
          'script_not_executable',
          'warning',
          `${path} is retained as a file but rdma26 does not execute skill scripts.`,
          path,
        ),
      );
    }

    const content = await readFile(filePath);

    if (binaryAssetExtensions.has(extension)) {
      continue;
    }

    if (content.includes(0)) {
      findings.push(
        finding('unsupported_binary_file', 'error', `${path} is not a supported text file.`, path),
      );
      continue;
    }

    const text = content.toString('utf8');
    combinedText += `\n${text}`;
    scanText(path, text, findings);
  }

  if (totalBytes > maxPackageBytes) {
    findings.push(
      finding(
        'package_size_limit',
        'error',
        `Package size ${totalBytes} exceeds the ${maxPackageBytes}-byte limit.`,
      ),
    );
  }

  const requirements = readRequirements(definition.frontmatter, combinedText);
  const missingCapabilities = requirements.capabilities.filter(
    (capability) => !enabledCapabilities.includes(capability),
  );

  for (const capability of missingCapabilities) {
    findings.push(
      finding(
        'missing_capability',
        'warning',
        `The skill expects capability ${capability}, but it is not enabled for the selected agent.`,
      ),
    );
  }

  for (const requirement of requirements.unsupported) {
    findings.push(
      finding(
        'unsupported_runtime_requirement',
        'warning',
        `Unsupported requirement: ${requirement}.`,
      ),
    );
  }

  const report = createReport(
    findings,
    requirements.capabilities,
    missingCapabilities,
    requirements.unsupported,
    hasScripts,
  );

  if (report.status === 'unsafe_or_invalid') {
    throw new SkillPackageValidationError('The skill package failed safety validation.', report);
  }

  return {
    definition,
    contentHash: await hashDirectory(directory),
    author: readString(definition.frontmatter['author']),
    license: await readLicense(directory, files, definition.frontmatter),
    version: readString(definition.frontmatter['version']),
    compatibility: report,
  };
}

export function toInstalledVersion(
  scanned: ScannedSkillPackage,
  installedAt: string,
  overrides: {
    readonly resolvedRevision?: string;
    readonly version?: string;
    readonly author?: string;
    readonly license?: string;
  } = {},
): SkillInstalledVersion {
  return {
    contentHash: scanned.contentHash,
    resolvedRevision: overrides.resolvedRevision,
    version: overrides.version ?? scanned.version,
    author: overrides.author ?? scanned.author,
    license: overrides.license ?? scanned.license,
    installedAt,
    compatibility: scanned.compatibility,
  };
}

function scanText(path: string, text: string, findings: SkillCompatibilityFinding[]): void {
  const secretPatterns: readonly [string, RegExp, string][] = [
    ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'Private key material'],
    ['openai_key', /\bsk-[A-Za-z0-9_-]{20,}\b/, 'OpenAI-style API credential'],
    ['aws_key', /\bAKIA[A-Z0-9]{16}\b/, 'AWS access key'],
    ['github_token', /\bgh[ps]_[A-Za-z0-9]{30,}\b/, 'GitHub access token'],
  ];

  for (const [code, pattern, label] of secretPatterns) {
    if (pattern.test(text)) {
      findings.push(finding(`embedded_${code}`, 'error', `${label} detected in ${path}.`, path));
    }
  }

  const dangerousPatterns: readonly [string, RegExp, string][] = [
    [
      'network_access',
      /\b(?:curl|wget|fetch|axios\.(?:get|post)|requests\.(?:get|post))\b/i,
      'direct network access',
    ],
    ['pipe_to_shell', /(?:curl|wget)[^\n|]{0,300}\|\s*(?:ba)?sh\b/i, 'downloads piped to a shell'],
    ['destructive_delete', /\brm\s+-rf\s+(?:\/|~|\$HOME)/i, 'destructive recursive deletion'],
    ['privilege_escalation', /\bsudo\b/i, 'privileged command execution'],
    ['dynamic_execution', /\b(?:eval|exec)\s*\(/i, 'dynamic code execution'],
  ];

  for (const [code, pattern, label] of dangerousPatterns) {
    if (pattern.test(text)) {
      findings.push(
        finding(
          code,
          'warning',
          `${path} contains ${label}; inspect it before installation.`,
          path,
        ),
      );
    }
  }
}

function readRequirements(
  frontmatter: Readonly<Record<string, unknown>>,
  combinedText: string,
): { capabilities: readonly string[]; unsupported: readonly string[] } {
  const capabilities = new Set<string>();
  const unsupported = new Set<string>();
  const metadata = readRecord(frontmatter['metadata']);
  const vendor =
    readRecord(metadata?.['openclaw']) ??
    readRecord(metadata?.['clawdbot']) ??
    readRecord(metadata?.['clawdis']);
  const requires = readRecord(vendor?.['requires']);

  for (const env of readStringArray(requires?.['env'])) {
    unsupported.add(`environment variable ${env}`);
  }

  for (const bin of [
    ...readStringArray(requires?.['bins']),
    ...readStringArray(requires?.['anyBins']),
  ]) {
    unsupported.add(`command-line program ${bin}`);
  }

  for (const config of readStringArray(requires?.['config'])) {
    unsupported.add(`OpenClaw configuration ${config}`);
  }

  if (Array.isArray(vendor?.['install'])) {
    unsupported.add('automatic dependency installation');
  }

  if (/\b(?:web_search|search the web|internet search)\b/i.test(combinedText)) {
    capabilities.add('web_search');
  }
  if (/\b(?:read_web_page|fetch (?:a )?(?:web )?page|open (?:the )?url)\b/i.test(combinedText)) {
    capabilities.add('web_page_access');
  }
  if (/\b(?:quickjs|\beval tool\b|code interpreter)\b/i.test(combinedText)) {
    capabilities.add('interpreter');
  }
  if (
    /\b(?:MCP server|model context protocol|Claude code execution|hosted code execution)\b/i.test(
      combinedText,
    )
  ) {
    unsupported.add('vendor-specific hosted tool or MCP runtime');
  }

  return {
    capabilities: [...capabilities].sort(),
    unsupported: [...unsupported].sort(),
  };
}

function createReport(
  findings: readonly SkillCompatibilityFinding[],
  requiredCapabilities: readonly string[],
  missingCapabilities: readonly string[],
  unsupportedRequirements: readonly string[],
  hasScripts: boolean,
): SkillCompatibilityReport {
  const status = findings.some((item) => item.severity === 'error')
    ? 'unsafe_or_invalid'
    : unsupportedRequirements.length
      ? 'unsupported_runtime'
      : missingCapabilities.length
        ? 'missing_capabilities'
        : hasScripts
          ? 'instructions_only'
          : 'compatible';

  return {
    status,
    requiredCapabilities,
    missingCapabilities,
    unsupportedRequirements,
    findings,
  };
}

function unsafeReport(findings: readonly SkillCompatibilityFinding[]): SkillCompatibilityReport {
  return {
    status: 'unsafe_or_invalid',
    requiredCapabilities: [],
    missingCapabilities: [],
    unsupportedRequirements: [],
    findings,
  };
}

function finding(
  code: string,
  severity: SkillCompatibilityFinding['severity'],
  message: string,
  path?: string,
): SkillCompatibilityFinding {
  return { code, severity, message, path };
}

function portableRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

async function readLicense(
  directory: string,
  files: readonly string[],
  frontmatter: Readonly<Record<string, unknown>>,
): Promise<string | undefined> {
  const declared = readString(frontmatter['license']);

  if (declared) {
    return declared;
  }

  const licenseFile = files.find((path) => /^license(?:\.[a-z0-9]+)?$/i.test(basename(path)));

  if (!licenseFile) {
    return undefined;
  }

  const firstLine = (
    await readFile(join(directory, portableRelativePath(directory, licenseFile)), 'utf8')
  )
    .split(/\r?\n/, 1)[0]
    ?.trim();
  return firstLine || basename(licenseFile);
}
