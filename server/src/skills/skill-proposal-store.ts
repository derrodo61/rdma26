import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SkillProposalRecord } from '../../../shared/agent-contracts';

export class SkillProposalStore {
  private readonly proposalsDir: string;

  constructor(readonly dataDir: string) {
    this.proposalsDir = join(dataDir, 'skills', 'proposals');
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.proposalsDir, { recursive: true });
  }

  async list(): Promise<readonly SkillProposalRecord[]> {
    await this.ensureReady();
    const entries = await readdir(this.proposalsDir, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return await this.readFile(this.recordPath(entry.name));
          } catch (error) {
            if (isNodeError(error) && error.code === 'ENOENT') {
              return undefined;
            }
            throw error;
          }
        }),
    );
    return records
      .filter((record): record is SkillProposalRecord => Boolean(record))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async read(proposalId: string): Promise<SkillProposalRecord | undefined> {
    validateProposalId(proposalId);
    try {
      return await this.readFile(this.recordPath(proposalId));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async require(proposalId: string): Promise<SkillProposalRecord> {
    const proposal = await this.read(proposalId);
    if (!proposal) {
      throw new Error(`Skill proposal ${proposalId} does not exist.`);
    }
    return proposal;
  }

  async write(record: SkillProposalRecord): Promise<void> {
    validateProposalId(record.id);
    const directory = this.proposalDirectory(record.id);
    await mkdir(directory, { recursive: true });
    const target = this.recordPath(record.id);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  }

  proposalDirectory(proposalId: string): string {
    validateProposalId(proposalId);
    return join(this.proposalsDir, proposalId);
  }

  packageDirectory(proposalId: string, skillId: string): string {
    return join(this.proposalDirectory(proposalId), skillId);
  }

  private recordPath(proposalId: string): string {
    return join(this.proposalDirectory(proposalId), 'proposal.json');
  }

  private async readFile(path: string): Promise<SkillProposalRecord> {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isProposal(value)) {
      throw new Error(`Invalid skill proposal record: ${path}`);
    }
    return value;
  }
}

function validateProposalId(id: string): void {
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    throw new Error(`Invalid skill proposal id ${JSON.stringify(id)}.`);
  }
}

function isProposal(value: unknown): value is SkillProposalRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<SkillProposalRecord>;
  return (
    typeof record.id === 'string' &&
    ['create', 'update', 'install'].includes(String(record.kind)) &&
    ['pending', 'stale', 'quarantined', 'applied', 'rejected', 'superseded'].includes(
      String(record.state),
    ) &&
    typeof record.skillId === 'string' &&
    typeof record.sourceContentHash === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    typeof record.actor === 'object' &&
    record.actor !== null &&
    Array.isArray(record.files) &&
    Array.isArray(record.changes)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
