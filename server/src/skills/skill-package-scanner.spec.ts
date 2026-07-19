import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scanSkillPackage, SkillPackageValidationError } from './skill-package-scanner';

describe('scanSkillPackage', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('classifies portable instructions as compatible', async () => {
    const directory = await createSkill(
      temporaryDirectories,
      'portable-skill',
      '# Workflow\nUse a checklist.',
    );

    await expect(scanSkillPackage(directory)).resolves.toMatchObject({
      definition: { id: 'portable-skill' },
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      compatibility: { status: 'compatible', findings: [] },
    });
  });

  it('classifies scripts, capabilities, and vendor requirements separately', async () => {
    const directory = await createSkill(
      temporaryDirectories,
      'integration-skill',
      '# Workflow\nUse web_search, then run scripts/check.py.',
      `metadata:
  openclaw:
    requires:
      env: [SERVICE_API_KEY]
`,
    );
    await mkdir(join(directory, 'scripts'));
    await writeFile(join(directory, 'scripts', 'check.py'), 'print("ok")\n', 'utf8');

    await expect(scanSkillPackage(directory)).resolves.toMatchObject({
      compatibility: {
        status: 'unsupported_runtime',
        requiredCapabilities: ['web_search'],
        missingCapabilities: ['web_search'],
        unsupportedRequirements: ['environment variable SERVICE_API_KEY'],
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'script_not_executable' }),
          expect.objectContaining({ code: 'missing_capability' }),
          expect.objectContaining({ code: 'unsupported_runtime_requirement' }),
        ]),
      },
    });

    await expect(scanSkillPackage(directory, ['web_search'])).resolves.toMatchObject({
      compatibility: { missingCapabilities: [] },
    });
  });

  it('reports a script-only package as instructions only', async () => {
    const directory = await createSkill(temporaryDirectories, 'script-skill', '# Workflow');
    await writeFile(join(directory, 'helper.sh'), '#!/bin/sh\necho ok\n', 'utf8');

    await expect(scanSkillPackage(directory)).resolves.toMatchObject({
      compatibility: { status: 'instructions_only' },
    });
  });

  it('blocks embedded credentials and executable binary types', async () => {
    const directory = await createSkill(
      temporaryDirectories,
      'unsafe-skill',
      '# Workflow\nToken: sk-abcdefghijklmnopqrstuvwxyz123456',
    );
    await writeFile(join(directory, 'payload.exe'), 'not actually executable', 'utf8');

    const error = await scanSkillPackage(directory).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SkillPackageValidationError);
    expect((error as SkillPackageValidationError).report).toMatchObject({
      status: 'unsafe_or_invalid',
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'embedded_openai_key', severity: 'error' }),
        expect.objectContaining({ code: 'executable_binary', severity: 'error' }),
      ]),
    });
  });
});

async function createSkill(
  temporaryDirectories: string[],
  name: string,
  body: string,
  extraFrontmatter = '',
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rdma26-scan-'));
  temporaryDirectories.push(root);
  const directory = join(root, name);
  await mkdir(directory);
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill.\n${extraFrontmatter}---\n\n${body}\n`,
    'utf8',
  );
  return directory;
}
