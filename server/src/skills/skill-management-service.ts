import type {
  AgentSkillsResponse,
  SkillPackageDetails,
  SkillPackageSummary,
  SkillsResponse,
  UpdateAgentSkillsRequest,
} from '../../../shared/agent-contracts';
import type { AgentRegistry } from '../agents/agent-registry';
import { normalizeSkillIds, type SkillLibrary } from './skill-library';

export class SkillManagementService {
  constructor(
    private readonly library: SkillLibrary,
    private readonly agents: AgentRegistry,
  ) {}

  async listSkills(): Promise<SkillsResponse> {
    return {
      skills: (await this.library.listPackages()).map(toSummary),
    };
  }

  async readSkill(skillId: string): Promise<SkillPackageDetails> {
    const skill = await this.library.inspectPackage(skillId);

    return {
      ...toSummary(skill),
      skillMarkdown: skill.skillMarkdown,
      files: skill.files,
    };
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
