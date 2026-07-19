import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import type {
  CreateSkillAuthoringProposalRequest,
  CreateSkillInstallProposalRequest,
  SkillProposalActor,
  SkillProposalRecord,
  SkillProposalsResponse,
} from '../../../shared/agent-contracts';
import { hashDirectory, listFiles, normalizeSkillIds, type SkillLibrary } from './skill-library';
import {
  scanSkillPackage,
  SkillPackageValidationError,
  type ScannedSkillPackage,
} from './skill-package-scanner';
import type { SkillManagementService } from './skill-management-service';
import { SkillProposalStore } from './skill-proposal-store';

const quarantineFindingCodes = new Set([
  'network_access',
  'pipe_to_shell',
  'destructive_delete',
  'privilege_escalation',
  'dynamic_execution',
]);

export class SkillProposalService {
  private readonly store: SkillProposalStore;

  constructor(
    readonly dataDir: string,
    private readonly library: SkillLibrary,
    private readonly skills: SkillManagementService,
  ) {
    this.store = new SkillProposalStore(dataDir);
  }

  async ensureReady(): Promise<void> {
    await this.store.ensureReady();
  }

  async list(): Promise<SkillProposalsResponse> {
    const proposals = await Promise.all(
      (await this.store.list()).map(async (proposal) => await this.refreshStaleState(proposal)),
    );
    return { proposals };
  }

  async read(proposalId: string): Promise<SkillProposalRecord> {
    return await this.refreshStaleState(await this.store.require(proposalId));
  }

  async createAuthoringProposal(
    kind: 'create' | 'update',
    request: CreateSkillAuthoringProposalRequest,
    actor: SkillProposalActor,
  ): Promise<SkillProposalRecord> {
    const [skillId] = normalizeSkillIds([request.skillId]);
    const installed = await this.installedSkill(skillId);

    if (kind === 'create' && installed) {
      throw new Error(`Skill ${skillId} is already installed.`);
    }
    if (kind === 'update' && (!installed || installed.ownership !== 'user')) {
      throw new Error(`Only an installed user-owned skill can receive an authoring update.`);
    }

    const id = crypto.randomUUID();
    const packageDirectory = this.store.packageDirectory(id, skillId);
    await this.writeCandidatePackage(packageDirectory, request);
    const files = await fileSummaries(packageDirectory);
    let scanned: ScannedSkillPackage;

    try {
      scanned = await scanSkillPackage(packageDirectory);
    } catch (error) {
      if (!(error instanceof SkillPackageValidationError)) {
        throw error;
      }
      const now = new Date().toISOString();
      const rejected: SkillProposalRecord = {
        id,
        kind,
        state: 'rejected',
        skillId,
        title: skillId,
        description: 'Rejected during package validation.',
        actor: { ...actor, evidence: request.evidence ?? actor.evidence },
        sourceContentHash: await hashDirectory(packageDirectory),
        targetContentHash:
          kind === 'update' && installed ? await hashDirectory(installed.directory) : undefined,
        compatibility: error.report,
        files,
        changes: files.map((file) => ({ path: file.path, kind: 'added' })),
        stateReason: error.message,
        createdAt: now,
        updatedAt: now,
      };
      await rm(packageDirectory, { recursive: true, force: true });
      await this.store.write(rejected);
      return rejected;
    }
    const changes =
      kind === 'update' && installed
        ? await compareDirectories(installed.directory, packageDirectory)
        : files.map((file) => ({ path: file.path, kind: 'added' as const }));
    const now = new Date().toISOString();
    const quarantined = scanned.compatibility.findings.some((finding) =>
      quarantineFindingCodes.has(finding.code),
    );
    const record: SkillProposalRecord = {
      id,
      kind,
      state: quarantined ? 'quarantined' : 'pending',
      skillId,
      title: scanned.definition.name,
      description: scanned.definition.description,
      actor: { ...actor, evidence: request.evidence ?? actor.evidence },
      sourceContentHash: scanned.contentHash,
      targetContentHash:
        kind === 'update' && installed ? await hashDirectory(installed.directory) : undefined,
      compatibility: scanned.compatibility,
      files,
      changes,
      stateReason: quarantined
        ? 'Potentially dangerous instructions require manual rejection or a revised proposal.'
        : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.supersedeOpenProposals(skillId);
    await this.store.write(record);
    return record;
  }

  async createInstallProposal(
    request: CreateSkillInstallProposalRequest,
    actor: SkillProposalActor,
  ): Promise<SkillProposalRecord> {
    const preview = await this.skills.inspectSkillInstallation(request.installation);
    if (await this.installedSkill(preview.skillId)) {
      throw new Error(`Skill ${preview.skillId} is already installed.`);
    }
    const now = new Date().toISOString();
    const quarantined = preview.candidate.compatibility.findings.some((finding) =>
      quarantineFindingCodes.has(finding.code),
    );
    const record: SkillProposalRecord = {
      id: crypto.randomUUID(),
      kind: 'install',
      state: quarantined ? 'quarantined' : 'pending',
      skillId: preview.skillId,
      title: preview.skillId,
      description: `Install ${preview.skillId} from ${request.installation.sourceType}.`,
      actor: { ...actor, evidence: request.evidence ?? actor.evidence },
      sourceContentHash: preview.candidate.contentHash,
      installationRequest: request.installation,
      compatibility: preview.candidate.compatibility,
      files: preview.files,
      changes: preview.files.map((file) => ({ path: file.path, kind: 'added' })),
      stateReason: quarantined
        ? 'Potentially dangerous instructions require manual rejection or a revised proposal.'
        : undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.supersedeOpenProposals(record.skillId);
    await this.store.write(record);
    return record;
  }

  async apply(proposalId: string): Promise<SkillProposalRecord> {
    let proposal = await this.read(proposalId);
    if (proposal.state !== 'pending') {
      throw new Error(`Only a pending skill proposal can be applied; it is ${proposal.state}.`);
    }

    try {
      if (proposal.kind === 'install') {
        if (!proposal.installationRequest) {
          throw new Error('Installation proposal source is missing.');
        }
        await this.skills.installInspectedSkill(
          proposal.installationRequest,
          proposal.sourceContentHash,
        );
      } else {
        const packageDirectory = this.store.packageDirectory(proposal.id, proposal.skillId);
        const scanned = await scanSkillPackage(packageDirectory);
        if (scanned.contentHash !== proposal.sourceContentHash) {
          throw new Error('The proposed package changed after review.');
        }
        await this.assertTargetCurrent(proposal);
        await this.library.applyUserPackage(
          packageDirectory,
          proposal.skillId,
          proposal.targetContentHash,
        );
      }
    } catch (error) {
      if (isStaleError(error)) {
        proposal = await this.transition(proposal, 'stale', getErrorMessage(error));
      }
      throw error;
    }

    const applied = await this.transition(proposal, 'applied', undefined, {
      appliedAt: new Date().toISOString(),
    });
    await this.supersedeOpenProposals(proposal.skillId, proposal.id);
    return applied;
  }

  async reject(proposalId: string, reason?: string): Promise<SkillProposalRecord> {
    const proposal = await this.read(proposalId);
    if (!['pending', 'quarantined', 'stale'].includes(proposal.state)) {
      throw new Error(`Skill proposal ${proposal.id} is already ${proposal.state}.`);
    }
    return await this.transition(proposal, 'rejected', reason?.trim() || 'Rejected by the user.');
  }

  private async refreshStaleState(proposal: SkillProposalRecord): Promise<SkillProposalRecord> {
    if (proposal.state !== 'pending') {
      return proposal;
    }
    try {
      await this.assertTargetCurrent(proposal);
      return proposal;
    } catch (error) {
      return await this.transition(proposal, 'stale', getErrorMessage(error));
    }
  }

  private async assertTargetCurrent(proposal: SkillProposalRecord): Promise<void> {
    const installed = await this.installedSkill(proposal.skillId);
    if (proposal.kind === 'create' || proposal.kind === 'install') {
      if (installed) {
        throw new Error(`Skill ${proposal.skillId} was installed after the proposal was created.`);
      }
      return;
    }
    if (!installed || installed.ownership !== 'user') {
      throw new Error(`The target user skill ${proposal.skillId} no longer exists.`);
    }
    if ((await hashDirectory(installed.directory)) !== proposal.targetContentHash) {
      throw new Error(`The target skill ${proposal.skillId} changed after proposal creation.`);
    }
  }

  private async installedSkill(skillId: string) {
    return (await this.library.listPackages()).find((skill) => skill.id === skillId);
  }

  private async writeCandidatePackage(
    packageDirectory: string,
    request: CreateSkillAuthoringProposalRequest,
  ): Promise<void> {
    const files = [
      { path: 'SKILL.md', content: request.skillMarkdown },
      ...(request.supportingFiles ?? []),
    ];
    const seen = new Set<string>();
    for (const file of files) {
      const path = normalizeProposalPath(file.path);
      if (seen.has(path)) {
        throw new Error(`Proposal contains duplicate file ${path}.`);
      }
      seen.add(path);
      const destination = join(packageDirectory, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, 'utf8');
    }
  }

  private async supersedeOpenProposals(skillId: string, exceptId?: string): Promise<void> {
    for (const proposal of await this.store.list()) {
      if (
        proposal.id !== exceptId &&
        proposal.skillId === skillId &&
        ['pending', 'quarantined'].includes(proposal.state)
      ) {
        await this.transition(proposal, 'superseded', 'A newer proposal targets this skill.');
      }
    }
  }

  private async transition(
    proposal: SkillProposalRecord,
    state: SkillProposalRecord['state'],
    stateReason?: string,
    extra: Pick<SkillProposalRecord, 'appliedAt'> = {},
  ): Promise<SkillProposalRecord> {
    const updated: SkillProposalRecord = {
      ...proposal,
      ...extra,
      state,
      stateReason,
      updatedAt: new Date().toISOString(),
    };
    await this.store.write(updated);
    return updated;
  }
}

function normalizeProposalPath(path: string): string {
  const normalized = path.trim().replaceAll('\\', '/');
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid supporting file path ${JSON.stringify(path)}.`);
  }
  return normalized;
}

async function fileSummaries(directory: string) {
  return await Promise.all(
    (await listFiles(directory)).map(async (file) => ({
      path: relative(directory, file).split(sep).join('/'),
      sizeBytes: (await stat(file)).size,
    })),
  );
}

async function compareDirectories(source: string, candidate: string) {
  const sourceFiles = new Map(
    (await listFiles(source)).map((file) => [relative(source, file).split(sep).join('/'), file]),
  );
  const candidateFiles = new Map(
    (await listFiles(candidate)).map((file) => [
      relative(candidate, file).split(sep).join('/'),
      file,
    ]),
  );
  const paths = [...new Set([...sourceFiles.keys(), ...candidateFiles.keys()])].sort();
  const changes = [];
  for (const path of paths) {
    const before = sourceFiles.get(path);
    const after = candidateFiles.get(path);
    if (!before) {
      changes.push({ path, kind: 'added' as const });
    } else if (!after) {
      changes.push({ path, kind: 'removed' as const });
    } else if (!(await readFile(before)).equals(await readFile(after))) {
      changes.push({ path, kind: 'modified' as const });
    }
  }
  return changes;
}

function isStaleError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /changed|no longer exists|was installed|after inspection/i.test(message);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
