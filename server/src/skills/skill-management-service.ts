import type {
  AgentSkillsResponse,
  CatalogSearchResponse,
  DeleteSkillResponse,
  InstallSkillRequest,
  SkillInstallationRecord,
  SkillInstallationPreview,
  SkillFileContentResponse,
  SkillPackageDetails,
  SkillPackageSummary,
  SkillUpdatePreview,
  SkillsResponse,
  UpdateAgentSkillsRequest,
} from '../../../shared/agent-contracts';
import type { AgentRegistry } from '../agents/agent-registry';
import { ClawHubCatalogAdapter } from './skill-catalog';
import { normalizeSkillIds, type SkillLibrary } from './skill-library';
import { SkillPackageInstaller } from './skill-package-installer';
import { scanSkillPackage } from './skill-package-scanner';

export class SkillManagementService {
  private readonly installer: SkillPackageInstaller;

  constructor(
    private readonly library: SkillLibrary,
    private readonly agents: AgentRegistry,
    installer?: SkillPackageInstaller,
  ) {
    this.installer =
      installer ??
      new SkillPackageInstaller(library.dataDir, library, [new ClawHubCatalogAdapter()]);
  }

  async listSkills(): Promise<SkillsResponse> {
    return {
      skills: (await this.library.listPackages()).map(toSummary),
    };
  }

  async readSkill(skillId: string): Promise<SkillPackageDetails> {
    const skill = await this.library.inspectPackage(skillId);

    return {
      ...toSummary(skill),
      contentHash: skill.contentHash,
      skillMarkdown: skill.skillMarkdown,
      files: skill.files,
    };
  }

  async readSkillFile(skillId: string, path: string): Promise<SkillFileContentResponse> {
    return await this.library.readPackageFile(skillId, path);
  }

  async cloneSkill(
    sourceSkillId: string,
    targetSkillId: string,
    expectedSourceHash: string,
  ): Promise<SkillPackageDetails> {
    await this.library.cloneToUser(sourceSkillId, targetSkillId, expectedSourceHash);
    return await this.readSkill(targetSkillId);
  }

  async updateUserSkill(
    skillId: string,
    skillMarkdown: string,
    expectedContentHash: string,
  ): Promise<SkillPackageDetails> {
    await this.library.updateUserSkill(
      skillId,
      skillMarkdown,
      expectedContentHash,
      async (directory) => {
        await scanSkillPackage(directory, [], skillId);
      },
    );
    return await this.readSkill(skillId);
  }

  async deleteSkill(skillId: string, expectedContentHash: string): Promise<DeleteSkillResponse> {
    const skill = await this.library.inspectPackage(skillId);
    const attachedAgents = (await this.agents.listAgents()).filter((agent) =>
      agent.attachedSkills.includes(skill.id),
    );

    if (attachedAgents.length) {
      throw new Error(
        `Skill ${skill.id} is attached to ${attachedAgents.map((agent) => agent.name).join(', ')} and cannot be deleted.`,
      );
    }

    switch (skill.ownership) {
      case 'bundled':
        throw new Error(`Bundled skill ${skill.id} cannot be deleted.`);
      case 'user':
        await this.library.deleteUserSkill(skill.id, expectedContentHash);
        break;
      case 'external':
        await this.installer.uninstall(skill.id, expectedContentHash);
        break;
    }

    return { deleted: true, skillId: skill.id };
  }

  async listInstallations(): Promise<readonly SkillInstallationRecord[]> {
    return await this.installer.listInstallations();
  }

  async installSkill(request: InstallSkillRequest): Promise<SkillInstallationRecord> {
    return await this.installer.install(request);
  }

  async inspectSkillInstallation(request: InstallSkillRequest): Promise<SkillInstallationPreview> {
    return await this.installer.inspectInstall(request);
  }

  async installInspectedSkill(
    request: InstallSkillRequest,
    expectedContentHash: string,
  ): Promise<SkillInstallationRecord> {
    return await this.installer.install(request, expectedContentHash);
  }

  async inspectSkillUpdate(
    skillId: string,
    enabledCapabilities: readonly string[] = [],
  ): Promise<SkillUpdatePreview> {
    return await this.installer.inspectUpdate(skillId, enabledCapabilities);
  }

  async applySkillUpdate(
    skillId: string,
    expectedContentHash: string,
    enabledCapabilities: readonly string[] = [],
  ): Promise<SkillInstallationRecord> {
    return await this.installer.applyUpdate(skillId, expectedContentHash, enabledCapabilities);
  }

  async setSkillPinned(skillId: string, pinned: boolean): Promise<SkillInstallationRecord> {
    return await this.installer.setPinned(skillId, pinned);
  }

  async rollbackSkill(skillId: string, contentHash?: string): Promise<SkillInstallationRecord> {
    return await this.installer.rollback(skillId, contentHash);
  }

  async searchCatalog(
    catalogId: string,
    query: string,
    limit?: number,
  ): Promise<CatalogSearchResponse> {
    return await this.installer.searchCatalog(catalogId, query, limit);
  }

  async readAgentSkills(agentId: string): Promise<AgentSkillsResponse> {
    const agent = await this.requireAgent(agentId);
    const packages = new Map((await this.library.listPackages()).map((skill) => [skill.id, skill]));

    return {
      agentId: agent.id,
      attachedSkillIds: agent.attachedSkills,
      requiredSkillIds: this.library.requiredAttachmentsForAgent(agent.id),
      skills: agent.attachedSkills.map((skillId) => {
        const skill = packages.get(skillId);

        if (!skill) {
          throw new Error(`Attached skill ${skillId} is not installed.`);
        }

        return toSummary(skill);
      }),
    };
  }

  async updateAgentSkills(
    agentId: string,
    request: UpdateAgentSkillsRequest,
  ): Promise<AgentSkillsResponse> {
    await this.requireAgent(agentId);
    const attachedSkillIds = normalizeSkillIds(request.attachedSkillIds);

    if (attachedSkillIds.length !== request.attachedSkillIds.length) {
      throw new Error('Attached skill ids must be unique.');
    }

    const requiredSkillIds = this.library.requiredAttachmentsForAgent(agentId);
    const missingRequiredSkill = requiredSkillIds.find(
      (skillId) => !attachedSkillIds.includes(skillId),
    );

    if (missingRequiredSkill) {
      throw new Error(`Skill ${missingRequiredSkill} is required for agent ${agentId}.`);
    }

    await this.library.resolveAttachedSkills(attachedSkillIds);
    await this.agents.updateAgentSkills(agentId, { attachedSkillIds });

    return await this.readAgentSkills(agentId);
  }

  async attachSkill(agentId: string, skillId: string): Promise<AgentSkillsResponse> {
    const agent = await this.requireAgent(agentId);
    const normalizedSkillId = normalizeSkillIds([skillId])[0];

    if (agent.attachedSkills.includes(normalizedSkillId)) {
      return await this.readAgentSkills(agentId);
    }

    return await this.updateAgentSkills(agentId, {
      attachedSkillIds: [...agent.attachedSkills, normalizedSkillId],
    });
  }

  async detachSkill(agentId: string, skillId: string): Promise<AgentSkillsResponse> {
    const agent = await this.requireAgent(agentId);
    const normalizedSkillId = normalizeSkillIds([skillId])[0];

    return await this.updateAgentSkills(agentId, {
      attachedSkillIds: agent.attachedSkills.filter(
        (attachedSkillId) => attachedSkillId !== normalizedSkillId,
      ),
    });
  }

  private async requireAgent(agentId: string) {
    const agent = await this.agents.readAgent(agentId);

    if (!agent) {
      throw new Error(`Agent ${agentId} does not exist.`);
    }

    return agent;
  }
}

function toSummary(skill: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownership: SkillPackageSummary['ownership'];
}): SkillPackageSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    ownership: skill.ownership,
  };
}
