import { createHash } from 'node:crypto';
import { access, chmod, cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import type {
  CatalogSearchResponse,
  InstallSkillRequest,
  SkillFileChange,
  SkillInstallationRecord,
  SkillInstallationSource,
  SkillUpdatePreview,
} from '../../../shared/agent-contracts';
import type { SkillCatalogAdapter } from './skill-catalog';
import { SkillInstallationStore } from './skill-installation-store';
import { hashDirectory, listFiles, type SkillLibrary } from './skill-library';
import {
  scanSkillPackage,
  toInstalledVersion,
  type ScannedSkillPackage,
} from './skill-package-scanner';
import {
  stageGitPackage,
  stageLocalDirectory,
  stageZipArchive,
  type StagedSkillPackage,
} from './skill-package-source';

interface ResolvedInstallSource {
  readonly staged: StagedSkillPackage;
  readonly source: SkillInstallationSource;
  readonly resolvedRevision?: string;
  readonly version?: string;
  readonly author?: string;
  readonly license?: string;
}

export class SkillPackageInstaller {
  private readonly installations: SkillInstallationStore;
  private readonly externalDir: string;

  constructor(
    readonly dataDir: string,
    private readonly library: SkillLibrary,
    private readonly catalogs: readonly SkillCatalogAdapter[],
  ) {
    this.installations = new SkillInstallationStore(dataDir);
    this.externalDir = join(dataDir, 'skills', 'external');
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.externalDir, { recursive: true });
    await this.installations.ensureReady();
  }

  async listInstallations(): Promise<readonly SkillInstallationRecord[]> {
    return await this.installations.list();
  }

  async searchCatalog(
    catalogId: string,
    query: string,
    limit?: number,
  ): Promise<CatalogSearchResponse> {
    return await this.requireCatalog(catalogId).search(query, limit);
  }

  async install(request: InstallSkillRequest): Promise<SkillInstallationRecord> {
    await this.ensureReady();
    const resolved = await this.resolveRequest(request);

    try {
      const scanned = await scanSkillPackage(
        resolved.staged.directory,
        request.enabledCapabilities ?? [],
      );

      if ((await this.library.listPackages()).some((skill) => skill.id === scanned.definition.id)) {
        throw new Error(`Skill ${scanned.definition.id} is already installed.`);
      }

      const now = new Date().toISOString();
      const version = toInstalledVersion(scanned, now, resolved);
      await this.persistVersion(scanned, resolved.staged.directory);
      const record: SkillInstallationRecord = {
        skillId: scanned.definition.id,
        source: resolved.source,
        activeContentHash: scanned.contentHash,
        pinned: false,
        installedAt: now,
        updatedAt: now,
        versions: [version],
      };
      await this.installations.write(record);
      return record;
    } finally {
      await resolved.staged.cleanup();
    }
  }

  async inspectUpdate(
    skillId: string,
    enabledCapabilities: readonly string[] = [],
  ): Promise<SkillUpdatePreview> {
    const record = await this.installations.require(skillId);
    const resolved = await this.resolveSource(record.source);

    try {
      const scanned = await scanSkillPackage(resolved.staged.directory, enabledCapabilities);
      this.assertSameSkill(record, scanned);
      const candidate = toInstalledVersion(scanned, new Date().toISOString(), resolved);

      return {
        skillId: record.skillId,
        currentContentHash: record.activeContentHash,
        candidate,
        changes: await diffDirectories(
          this.versionDirectory(record.skillId, record.activeContentHash),
          resolved.staged.directory,
        ),
        updateAvailable: candidate.contentHash !== record.activeContentHash,
      };
    } finally {
      await resolved.staged.cleanup();
    }
  }

  async applyUpdate(
    skillId: string,
    expectedContentHash: string,
    enabledCapabilities: readonly string[] = [],
  ): Promise<SkillInstallationRecord> {
    const record = await this.installations.require(skillId);

    if (record.pinned) {
      throw new Error(`Skill ${record.skillId} is pinned and cannot be updated.`);
    }

    const resolved = await this.resolveSource(record.source);

    try {
      const scanned = await scanSkillPackage(resolved.staged.directory, enabledCapabilities);
      this.assertSameSkill(record, scanned);

      if (scanned.contentHash !== expectedContentHash) {
        throw new Error(
          'The skill update changed after inspection; inspect it again before applying.',
        );
      }

      if (scanned.contentHash === record.activeContentHash) {
        return record;
      }

      const now = new Date().toISOString();
      const version = toInstalledVersion(scanned, now, resolved);
      await this.persistVersion(scanned, resolved.staged.directory);
      const updated: SkillInstallationRecord = {
        ...record,
        activeContentHash: scanned.contentHash,
        updatedAt: now,
        versions: [
          ...record.versions.filter((item) => item.contentHash !== scanned.contentHash),
          version,
        ],
      };
      await this.installations.write(updated);
      return updated;
    } finally {
      await resolved.staged.cleanup();
    }
  }

  async setPinned(skillId: string, pinned: boolean): Promise<SkillInstallationRecord> {
    const record = await this.installations.require(skillId);
    const updated = {
      ...record,
      pinned,
      updatedAt: new Date().toISOString(),
    };
    await this.installations.write(updated);
    return updated;
  }

  async rollback(skillId: string, contentHash?: string): Promise<SkillInstallationRecord> {
    const record = await this.installations.require(skillId);
    const target = contentHash
      ? record.versions.find((version) => version.contentHash === contentHash)
      : [...record.versions]
          .reverse()
          .find((version) => version.contentHash !== record.activeContentHash);

    if (!target) {
      throw new Error(`Skill ${skillId} has no matching previous version to restore.`);
    }

    const updated: SkillInstallationRecord = {
      ...record,
      activeContentHash: target.contentHash,
      updatedAt: new Date().toISOString(),
    };
    await this.installations.write(updated);
    return updated;
  }

  private async resolveRequest(request: InstallSkillRequest): Promise<ResolvedInstallSource> {
    switch (request.sourceType) {
      case 'local-directory':
        return {
          staged: await stageLocalDirectory(request.path),
          source: { type: request.sourceType, path: resolve(request.path) },
        };
      case 'local-archive':
        return {
          staged: await stageZipArchive(request.path),
          source: { type: request.sourceType, path: resolve(request.path) },
        };
      case 'git': {
        const staged = await stageGitPackage({
          repositoryUrl: request.repositoryUrl,
          packagePath: request.packagePath,
          revision: request.revision,
        });
        return {
          staged,
          source: {
            type: request.sourceType,
            url: request.repositoryUrl,
            packagePath: request.packagePath,
            requestedRevision: request.revision,
          },
          resolvedRevision: staged.resolvedRevision,
        };
      }
      case 'clawhub': {
        const catalog = this.requireCatalog('clawhub');
        const resolved = await catalog.resolve(request.slug, request.version);
        return {
          ...resolved,
          source: {
            type: request.sourceType,
            url: resolved.canonicalUrl,
            catalogId: catalog.id,
            catalogSkillId: resolved.catalogSkillId,
            requestedRevision: request.version,
          },
        };
      }
    }
  }

  private async resolveSource(source: SkillInstallationSource): Promise<ResolvedInstallSource> {
    switch (source.type) {
      case 'local-directory':
        return {
          staged: await stageLocalDirectory(requireField(source.path, 'Local source path')),
          source,
        };
      case 'local-archive':
        return {
          staged: await stageZipArchive(requireField(source.path, 'Archive source path')),
          source,
        };
      case 'git': {
        const staged = await stageGitPackage({
          repositoryUrl: requireField(source.url, 'Git source URL'),
          packagePath: source.packagePath,
          revision: source.requestedRevision,
        });
        return { staged, source, resolvedRevision: staged.resolvedRevision };
      }
      case 'clawhub': {
        const catalog = this.requireCatalog(source.catalogId ?? 'clawhub');
        const resolved = await catalog.resolve(
          requireField(source.catalogSkillId, 'Catalog skill id'),
          undefined,
        );
        return { ...resolved, source };
      }
    }
  }

  private async persistVersion(
    scanned: ScannedSkillPackage,
    sourceDirectory: string,
  ): Promise<void> {
    const destination = this.versionDirectory(scanned.definition.id, scanned.contentHash);

    if (await pathExists(destination)) {
      if ((await hashDirectory(destination)) !== scanned.contentHash) {
        throw new Error('Stored skill version content does not match its content hash.');
      }
      return;
    }

    const parent = join(this.externalDir, scanned.definition.id);
    const staging = join(parent, `.installing-${scanned.contentHash}-${crypto.randomUUID()}`);
    await mkdir(parent, { recursive: true });

    try {
      await cp(sourceDirectory, staging, {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      await Promise.all((await listFiles(staging)).map(async (file) => await chmod(file, 0o644)));
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (!(await pathExists(destination))) {
        throw error;
      }
    }
  }

  private versionDirectory(skillId: string, contentHash: string): string {
    return join(this.externalDir, skillId, contentHash);
  }

  private requireCatalog(id: string): SkillCatalogAdapter {
    const catalog = this.catalogs.find((candidate) => candidate.id === id);

    if (!catalog) {
      throw new Error(`Skill catalog ${id} is not configured.`);
    }

    return catalog;
  }

  private assertSameSkill(record: SkillInstallationRecord, scanned: ScannedSkillPackage): void {
    if (record.skillId !== scanned.definition.id) {
      throw new Error(
        `Update source now contains skill ${scanned.definition.id}, expected ${record.skillId}.`,
      );
    }
  }
}

async function diffDirectories(
  currentDirectory: string,
  candidateDirectory: string,
): Promise<readonly SkillFileChange[]> {
  const [current, candidate] = await Promise.all([
    fileHashes(currentDirectory),
    fileHashes(candidateDirectory),
  ]);
  const paths = new Set([...current.keys(), ...candidate.keys()]);
  const changes: SkillFileChange[] = [];

  for (const path of [...paths].sort()) {
    if (!current.has(path)) {
      changes.push({ path, kind: 'added' });
    } else if (!candidate.has(path)) {
      changes.push({ path, kind: 'removed' });
    } else if (current.get(path) !== candidate.get(path)) {
      changes.push({ path, kind: 'modified' });
    }
  }

  return changes;
}

async function fileHashes(directory: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  for (const file of await listFiles(directory)) {
    const path = relative(directory, file).split(sep).join('/');
    const content = await readFile(file);
    hashes.set(path, createHash('sha256').update(content).digest('hex'));
  }

  return hashes;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function requireField(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} is missing from the installation record.`);
  }

  return value;
}
