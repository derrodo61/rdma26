import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SkillInstallationRecord } from '../../../shared/agent-contracts';

export class SkillInstallationStore {
  private readonly installationsDir: string;

  constructor(readonly dataDir: string) {
    this.installationsDir = join(dataDir, 'skills', 'installations');
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.installationsDir, { recursive: true });
  }

  async list(): Promise<readonly SkillInstallationRecord[]> {
    await this.ensureReady();
    const entries = await readdir(this.installationsDir, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => await this.readFile(join(this.installationsDir, entry.name))),
    );

    return records.sort((left, right) => left.skillId.localeCompare(right.skillId));
  }

  async read(skillId: string): Promise<SkillInstallationRecord | undefined> {
    const normalizedId = normalizeSkillId(skillId);
    await this.ensureReady();

    try {
      return await this.readFile(this.recordPath(normalizedId));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async require(skillId: string): Promise<SkillInstallationRecord> {
    const record = await this.read(skillId);

    if (!record) {
      throw new Error(`External skill ${skillId} is not installed.`);
    }

    return record;
  }

  async write(record: SkillInstallationRecord): Promise<void> {
    const normalizedId = normalizeSkillId(record.skillId);

    if (normalizedId !== record.skillId) {
      throw new Error(`Installation record skill id ${record.skillId} is not normalized.`);
    }

    await this.ensureReady();
    const target = this.recordPath(record.skillId);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  }

  async delete(skillId: string): Promise<void> {
    const normalizedId = normalizeSkillId(skillId);
    await rm(this.recordPath(normalizedId), { force: false });
  }

  private recordPath(skillId: string): string {
    return join(this.installationsDir, `${skillId}.json`);
  }

  private async readFile(path: string): Promise<SkillInstallationRecord> {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;

    if (!isInstallationRecord(value)) {
      throw new Error(`Invalid skill installation record: ${path}`);
    }

    return value;
  }
}

function normalizeSkillId(skillId: string): string {
  const normalized = skillId.trim();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) || normalized.length > 64) {
    throw new Error(`Invalid skill id ${JSON.stringify(skillId)}.`);
  }

  return normalized;
}

function isInstallationRecord(value: unknown): value is SkillInstallationRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Partial<SkillInstallationRecord>;
  return (
    typeof record.skillId === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.skillId) &&
    isInstallationSource(record.source) &&
    typeof record.activeContentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(record.activeContentHash) &&
    typeof record.pinned === 'boolean' &&
    typeof record.installedAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    Array.isArray(record.versions) &&
    record.versions.length > 0 &&
    record.versions.every(isInstalledVersion) &&
    record.versions.some((version) => version.contentHash === record.activeContentHash)
  );
}

function isInstallationSource(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const source = value as Record<string, unknown>;
  return ['local-directory', 'local-archive', 'git', 'clawhub'].includes(String(source['type']));
}

function isInstalledVersion(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const version = value as Record<string, unknown>;
  return (
    typeof version['contentHash'] === 'string' &&
    /^[a-f0-9]{64}$/.test(version['contentHash']) &&
    typeof version['installedAt'] === 'string' &&
    typeof version['compatibility'] === 'object' &&
    version['compatibility'] !== null
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
