import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

import { parse, parseDocument } from 'yaml';

import { pricingSourceAnalysisSkillContent } from '../storage/assistant-storage';

import type {
  SkillFileContentResponse,
  SkillFileSummary,
  SkillOwnership,
} from '../../../shared/agent-contracts';
import { SkillInstallationStore } from './skill-installation-store';

export interface SkillPackageDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownership: SkillOwnership;
  readonly directory: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

export interface AgentSkillSource {
  readonly id: string;
  readonly virtualPath: string;
  readonly directory: string;
}

export interface SkillPackageInspection extends SkillPackageDefinition {
  readonly contentHash: string;
  readonly skillMarkdown: string;
  readonly files: readonly SkillFileSummary[];
}

const pricingSourceAnalysisSkillId = 'pricing-source-analysis';
const obsoleteSkillIds = new Set(['web-research']);

export class SkillLibrary {
  private readonly libraryDir: string;
  private readonly bundledDir: string;
  private readonly userDir: string;
  private readonly externalDir: string;
  private readonly emptyRuntimeDir: string;
  private readonly installations: SkillInstallationStore;

  constructor(readonly dataDir: string) {
    this.libraryDir = join(dataDir, 'skills');
    this.bundledDir = join(this.libraryDir, 'bundled');
    this.userDir = join(this.libraryDir, 'user');
    this.externalDir = join(this.libraryDir, 'external');
    this.emptyRuntimeDir = join(this.libraryDir, '.runtime-empty');
    this.installations = new SkillInstallationStore(dataDir);
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.bundledDir, { recursive: true });
    await mkdir(this.userDir, { recursive: true });
    await mkdir(this.externalDir, { recursive: true });
    await mkdir(this.emptyRuntimeDir, { recursive: true });
    await this.installations.ensureReady();
    const pricingSkillDir = join(this.bundledDir, pricingSourceAnalysisSkillId);
    await mkdir(pricingSkillDir, { recursive: true });
    await writeFile(join(pricingSkillDir, 'SKILL.md'), pricingSourceAnalysisSkillContent, 'utf8');
  }

  requiredAttachmentsForAgent(agentId: string): readonly string[] {
    return agentId === 'cost-analyst' ? [pricingSourceAnalysisSkillId] : [];
  }

  runtimeFallbackDirectory(): string {
    return this.emptyRuntimeDir;
  }

  async listPackages(): Promise<readonly SkillPackageDefinition[]> {
    await this.ensureReady();
    const definitions = [
      ...(await this.readPackagesFromRoot(this.bundledDir, 'bundled')),
      ...(await this.readPackagesFromRoot(this.userDir, 'user')),
      ...(await this.readExternalPackages()),
    ];
    const seen = new Set<string>();

    for (const definition of definitions) {
      if (seen.has(definition.id)) {
        throw new Error(`Skill ${definition.id} is installed more than once.`);
      }
      seen.add(definition.id);
    }

    return definitions.sort((left, right) => left.id.localeCompare(right.id));
  }

  async resolveAttachedSkills(
    attachedSkillIds: readonly string[],
  ): Promise<readonly AgentSkillSource[]> {
    const normalizedIds = normalizeSkillIds(attachedSkillIds);
    const packages = new Map((await this.listPackages()).map((skill) => [skill.id, skill]));

    return normalizedIds.map((id) => {
      const skill = packages.get(id);

      if (!skill) {
        throw new Error(`Attached skill ${id} is not installed.`);
      }

      return {
        id,
        virtualPath: `/skills/${id}/`,
        directory: skill.directory,
      };
    });
  }

  async inspectPackage(skillId: string): Promise<SkillPackageInspection> {
    const [normalizedId] = normalizeSkillIds([skillId]);
    const skill = (await this.listPackages()).find((candidate) => candidate.id === normalizedId);

    if (!skill) {
      throw new Error(`Skill ${normalizedId} is not installed.`);
    }

    const filePaths = await listFiles(skill.directory);

    return {
      ...skill,
      contentHash: await hashDirectory(skill.directory),
      skillMarkdown: await readFile(join(skill.directory, 'SKILL.md'), 'utf8'),
      files: await Promise.all(
        filePaths.map(async (filePath) => ({
          path: relative(skill.directory, filePath).split(sep).join('/'),
          sizeBytes: (await stat(filePath)).size,
        })),
      ),
    };
  }

  async readPackageFile(skillId: string, path: string): Promise<SkillFileContentResponse> {
    const [normalizedId] = normalizeSkillIds([skillId]);
    const normalizedPath = normalizePackageFilePath(path);
    const skill = (await this.listPackages()).find((candidate) => candidate.id === normalizedId);

    if (!skill) {
      throw new Error(`Skill ${normalizedId} is not installed.`);
    }

    const files = await listFiles(skill.directory);
    const filePath = files.find(
      (candidate) => relative(skill.directory, candidate).split(sep).join('/') === normalizedPath,
    );

    if (!filePath) {
      throw new Error(`Skill ${normalizedId} does not contain file ${normalizedPath}.`);
    }

    return {
      skillId: normalizedId,
      path: normalizedPath,
      content: await readFile(filePath, 'utf8'),
      sizeBytes: (await stat(filePath)).size,
    };
  }

  async cloneToUser(
    sourceSkillId: string,
    targetSkillId: string,
    expectedSourceHash: string,
  ): Promise<void> {
    const [normalizedSourceId] = normalizeSkillIds([sourceSkillId]);
    const [normalizedTargetId] = normalizeSkillIds([targetSkillId]);
    const source = (await this.listPackages()).find((skill) => skill.id === normalizedSourceId);

    if (!source) {
      throw new Error(`Skill ${normalizedSourceId} is not installed.`);
    }
    if (source.ownership === 'user') {
      throw new Error(
        `Skill ${normalizedSourceId} is already user-owned and can be edited directly.`,
      );
    }
    if ((await hashDirectory(source.directory)) !== expectedSourceHash) {
      throw new Error(`Skill ${normalizedSourceId} changed after it was inspected.`);
    }
    if ((await this.listPackages()).some((skill) => skill.id === normalizedTargetId)) {
      throw new Error(`Skill ${normalizedTargetId} is already installed.`);
    }

    const staging = join(this.userDir, `.cloning-${normalizedTargetId}-${crypto.randomUUID()}`);

    try {
      await cp(source.directory, staging, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      const skillPath = join(staging, 'SKILL.md');
      const content = await readFile(skillPath, 'utf8');
      await writeFile(skillPath, rewriteSkillName(content, skillPath, normalizedTargetId), 'utf8');
      await readSkillPackage(staging, 'user', normalizedTargetId);
      await rename(staging, join(this.userDir, normalizedTargetId));
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async updateUserSkill(
    skillId: string,
    skillMarkdown: string,
    expectedContentHash: string,
    validate?: (directory: string) => Promise<void>,
  ): Promise<void> {
    const [normalizedId] = normalizeSkillIds([skillId]);
    const existing = (await this.listPackages()).find((skill) => skill.id === normalizedId);

    if (!existing) {
      throw new Error(`Skill ${normalizedId} is not installed.`);
    }
    if (existing.ownership !== 'user') {
      throw new Error(`Skill ${normalizedId} is ${existing.ownership} and cannot be edited.`);
    }
    if ((await hashDirectory(existing.directory)) !== expectedContentHash) {
      throw new Error(`Skill ${normalizedId} changed after it was inspected.`);
    }

    const staging = join(this.userDir, `.editing-${normalizedId}-${crypto.randomUUID()}`);

    try {
      await cp(existing.directory, staging, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      await writeFile(join(staging, 'SKILL.md'), skillMarkdown, 'utf8');
      await readSkillPackage(staging, 'user', normalizedId);
      await validate?.(staging);
      await this.applyUserPackage(staging, normalizedId, expectedContentHash);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async deleteUserSkill(skillId: string, expectedContentHash: string): Promise<void> {
    const [normalizedId] = normalizeSkillIds([skillId]);
    const existing = (await this.listPackages()).find((skill) => skill.id === normalizedId);

    if (!existing) {
      throw new Error(`Skill ${normalizedId} is not installed.`);
    }
    if (existing.ownership !== 'user') {
      throw new Error(`Skill ${normalizedId} is ${existing.ownership} and cannot be deleted here.`);
    }
    if ((await hashDirectory(existing.directory)) !== expectedContentHash) {
      throw new Error(`Skill ${normalizedId} changed after it was inspected.`);
    }

    await rm(existing.directory, { recursive: true, force: false });
  }

  async applyUserPackage(
    sourceDirectory: string,
    skillId: string,
    expectedTargetHash?: string,
  ): Promise<void> {
    const [normalizedId] = normalizeSkillIds([skillId]);
    const existing = (await this.listPackages()).find((skill) => skill.id === normalizedId);

    if (existing && existing.ownership !== 'user') {
      throw new Error(`Skill ${normalizedId} is ${existing.ownership} and cannot be overwritten.`);
    }
    if (!expectedTargetHash && existing) {
      throw new Error(`Skill ${normalizedId} is already installed.`);
    }
    if (expectedTargetHash && !existing) {
      throw new Error(`Skill ${normalizedId} no longer exists.`);
    }
    if (
      expectedTargetHash &&
      existing &&
      (await hashDirectory(existing.directory)) !== expectedTargetHash
    ) {
      throw new Error(`Skill ${normalizedId} changed after the proposal was created.`);
    }

    const destination = join(this.userDir, normalizedId);
    const staging = join(this.userDir, `.importing-${normalizedId}-${crypto.randomUUID()}`);
    const backup = join(this.userDir, `.replacing-${normalizedId}-${crypto.randomUUID()}`);

    try {
      await cp(sourceDirectory, staging, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      await readSkillPackage(staging, 'user', normalizedId);

      if (existing) {
        await rename(destination, backup);
      }
      await rename(staging, destination);
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (existing) {
        try {
          await lstat(destination);
        } catch {
          await rename(backup, destination);
        }
      }
      throw error;
    }
  }

  async migrateAgentLocalSkills(
    agentId: string,
    legacySkillsDir: string,
    legacySkillsBackupDir: string,
    attachedSkillIds: readonly string[],
  ): Promise<readonly string[]> {
    await this.ensureReady();
    const attachments = new Set(normalizeSkillIds(attachedSkillIds));

    for (const defaultSkillId of this.requiredAttachmentsForAgent(agentId)) {
      attachments.add(defaultSkillId);
    }

    const entries = await readDirectories(legacySkillsDir);

    for (const entry of entries) {
      const legacySkillDir = join(legacySkillsDir, entry.name);

      if (obsoleteSkillIds.has(entry.name)) {
        await rm(legacySkillDir, { recursive: true, force: true });
        continue;
      }

      if (agentId === 'cost-analyst' && entry.name === pricingSourceAnalysisSkillId) {
        attachments.add(pricingSourceAnalysisSkillId);
        continue;
      }

      const legacySkill = await readSkillPackage(legacySkillDir, 'user');
      const legacySkillHash = await hashDirectory(legacySkillDir);
      const installedSkill = (await this.listPackages()).find(
        (skill) => skill.id === legacySkill.id,
      );

      if (installedSkill) {
        if ((await hashDirectory(installedSkill.directory)) !== legacySkillHash) {
          throw new Error(
            `Cannot migrate skill ${legacySkill.id} for agent ${agentId}: an installed package with different content already exists.`,
          );
        }
      } else {
        await this.copyLegacySkill(legacySkillDir, legacySkill.id);
      }

      attachments.add(legacySkill.id);
    }

    await archiveLegacySkills(legacySkillsDir, legacySkillsBackupDir);

    return [...attachments].sort();
  }

  private async copyLegacySkill(sourceDir: string, skillId: string): Promise<void> {
    const destinationDir = join(this.userDir, skillId);
    const stagingDir = join(this.userDir, `.importing-${skillId}-${crypto.randomUUID()}`);

    try {
      await cp(sourceDir, stagingDir, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      await rename(stagingDir, destinationDir);
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  private async readPackagesFromRoot(
    rootDir: string,
    ownership: SkillOwnership,
  ): Promise<readonly SkillPackageDefinition[]> {
    const entries = await readDirectories(rootDir);
    return await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map(async (entry) => await readSkillPackage(join(rootDir, entry.name), ownership)),
    );
  }

  private async readExternalPackages(): Promise<readonly SkillPackageDefinition[]> {
    return await Promise.all(
      (await this.installations.list()).map(async (installation) => {
        const directory = join(
          this.externalDir,
          installation.skillId,
          installation.activeContentHash,
        );

        if ((await hashDirectory(directory)) !== installation.activeContentHash) {
          throw new Error(`Installed skill ${installation.skillId} failed its content hash check.`);
        }

        return await readSkillPackage(directory, 'external', installation.skillId);
      }),
    );
  }
}

async function archiveLegacySkills(sourceDir: string, backupDir: string): Promise<void> {
  try {
    await lstat(sourceDir);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  await mkdir(dirname(backupDir), { recursive: true });

  try {
    await lstat(backupDir);
    if ((await hashDirectory(sourceDir)) !== (await hashDirectory(backupDir))) {
      throw new Error(
        'Cannot archive legacy skills: a backup with different content already exists.',
      );
    }
    await rm(sourceDir, { recursive: true, force: true });
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
    await rename(sourceDir, backupDir);
  }
}

export function normalizeSkillIds(ids: readonly unknown[]): readonly string[] {
  return Array.from(
    new Set(
      ids
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => {
          validateSkillId(id);
          return id;
        }),
    ),
  ).sort();
}

export async function readSkillPackage(
  directory: string,
  ownership: SkillOwnership,
  expectedName = basename(directory),
): Promise<SkillPackageDefinition> {
  const skillPath = join(directory, 'SKILL.md');
  let content: string;

  try {
    content = await readFile(skillPath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(`Skill package ${directory} does not contain SKILL.md.`);
    }
    throw error;
  }

  const frontmatter = parseFrontmatter(content, skillPath);
  const name = readRequiredString(frontmatter, 'name', skillPath);
  const description = readRequiredString(frontmatter, 'description', skillPath);
  validateSkillId(name);

  if (description.length > 1024) {
    throw new Error(`Skill description in ${skillPath} exceeds 1024 characters.`);
  }

  if (expectedName !== name) {
    throw new Error(`Skill name ${name} must match its directory name ${expectedName}.`);
  }

  return {
    id: name,
    name,
    description,
    ownership,
    directory,
    frontmatter,
  };
}

function parseFrontmatter(content: string, path: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match?.[1]) {
    throw new Error(`Skill ${path} must start with YAML frontmatter.`);
  }

  const value = parse(match[1]) as unknown;

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Skill ${path} has invalid YAML frontmatter.`);
  }

  return value as Record<string, unknown>;
}

function rewriteSkillName(content: string, path: string, name: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---((?:\r?\n|$)[\s\S]*)$/);

  if (!match?.[1] || match[2] === undefined) {
    throw new Error(`Skill ${path} must start with YAML frontmatter.`);
  }

  const document = parseDocument(match[1]);
  if (document.errors.length) {
    throw new Error(`Skill ${path} has invalid YAML frontmatter.`);
  }
  document.set('name', name);
  return `---\n${document.toString().trimEnd()}\n---${match[2]}`;
}

function readRequiredString(value: Record<string, unknown>, key: string, path: string): string {
  const field = value[key];

  if (typeof field !== 'string' || !field.trim()) {
    throw new Error(`Skill ${path} requires a non-empty ${key} field.`);
  }

  return field.trim();
}

function validateSkillId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) {
    throw new Error(
      `Invalid skill id ${JSON.stringify(id)}. Use 1-64 lowercase letters, numbers, and single hyphens.`,
    );
  }
}

function normalizePackageFilePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim();

  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid skill file path ${JSON.stringify(path)}.`);
  }

  return normalized;
}

async function readDirectories(path: string): Promise<readonly import('node:fs').Dirent[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function hashDirectory(rootDir: string): Promise<string> {
  const hash = createHash('sha256');

  for (const filePath of await listFiles(rootDir)) {
    hash.update(relative(rootDir, filePath));
    hash.update('\0');
    hash.update(await readFile(filePath));
    hash.update('\0');
  }

  return hash.digest('hex');
}

export async function listFiles(rootDir: string): Promise<readonly string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(rootDir, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(`Skill package ${rootDir} contains unsupported symbolic link ${entry.name}.`);
    }

    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      const info = await lstat(path);
      if (!info.isFile()) {
        throw new Error(`Skill package ${rootDir} contains unsupported entry ${entry.name}.`);
      }
      files.push(path);
    }
  }

  return files;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
