import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { InstallSkillRequest } from '../../../shared/agent-contracts';

export interface SkillProposalToolRuntime {
  listSkills(): Promise<unknown>;
  readSkill(skillId: string): Promise<unknown>;
  listSkillProposals(): Promise<unknown>;
  readSkillProposal(proposalId: string): Promise<unknown>;
  searchSkillCatalog(catalogId: string, query: string, limit?: number): Promise<unknown>;
  inspectSkillInstallation(request: InstallSkillRequest): Promise<unknown>;
  proposeSkillCreate(request: AuthoringInput, actor: SkillToolActor): Promise<unknown>;
  proposeSkillUpdate(request: AuthoringInput, actor: SkillToolActor): Promise<unknown>;
  proposeSkillInstall(
    request: { installation: InstallSkillRequest; evidence?: string },
    actor: SkillToolActor,
  ): Promise<unknown>;
}

export interface SkillToolActor {
  readonly agentId: string;
  readonly threadId?: string;
}

export interface SkillDiscoveryState {
  searchedInstalled: boolean;
  searchedCatalog: boolean;
}

interface AuthoringInput {
  readonly skillId: string;
  readonly skillMarkdown: string;
  readonly supportingFiles?: readonly { readonly path: string; readonly content: string }[];
  readonly evidence?: string;
}

const supportingFilesSchema = z
  .array(
    z.object({
      path: z.string().min(1).describe('Portable relative path inside the skill package.'),
      content: z.string().describe('Complete UTF-8 file content.'),
    }),
  )
  .max(50)
  .optional();

const authoringSchema = z.object({
  skillId: z.string().min(1).describe('Lowercase Agent Skills package id.'),
  skillMarkdown: z
    .string()
    .min(1)
    .describe('Complete SKILL.md with valid YAML frontmatter and workflow instructions.'),
  supportingFiles: supportingFilesSchema,
  evidence: z.string().max(4000).optional().describe('Why this reusable workflow is needed.'),
});

const installationSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('clawhub'),
    slug: z.string().min(1),
    version: z.string().min(1).optional(),
  }),
  z.object({
    sourceType: z.literal('git'),
    repositoryUrl: z.string().url(),
    packagePath: z.string().min(1).optional(),
    revision: z.string().min(1).optional(),
  }),
]);

const comparisonCandidateSchema = z.discriminatedUnion('sourceType', [
  z.object({ sourceType: z.literal('installed'), skillId: z.string().min(1) }),
  z.object({
    sourceType: z.literal('clawhub'),
    slug: z.string().min(1),
    version: z.string().min(1).optional(),
  }),
]);

export function createSkillAuthoringTools(
  runtime: SkillProposalToolRuntime,
  actor: SkillToolActor,
  discovery: SkillDiscoveryState,
  requireDiscovery: boolean,
): readonly StructuredToolInterface[] {
  const assertDiscovery = (): void => {
    if (requireDiscovery && (!discovery.searchedInstalled || !discovery.searchedCatalog)) {
      throw new Error(
        'Search both installed skills and the trusted catalog before proposing a new or revised skill.',
      );
    }
  };

  return [
    tool(async () => await runtime.listSkillProposals(), {
      name: 'list_skill_proposals',
      description: 'List persisted skill proposals and their review states.',
      schema: z.object({}),
    }),
    tool(
      async ({ proposalId }: { proposalId: string }) => await runtime.readSkillProposal(proposalId),
      {
        name: 'inspect_skill_proposal',
        description: 'Inspect one skill proposal, including files, changes, and safety findings.',
        schema: z.object({ proposalId: z.string().uuid() }),
      },
    ),
    tool(
      async (input: AuthoringInput) => {
        assertDiscovery();
        return await runtime.proposeSkillCreate(input, actor);
      },
      {
        name: 'propose_skill_create',
        description:
          'Draft a new user-owned Agent Skills package for explicit user review. This never installs or attaches it.',
        schema: authoringSchema,
      },
    ),
    tool(
      async (input: AuthoringInput) => {
        assertDiscovery();
        return await runtime.proposeSkillUpdate(input, actor);
      },
      {
        name: 'propose_skill_update',
        description:
          'Draft a complete revision of an existing user-owned skill for explicit user review. This never applies it.',
        schema: authoringSchema,
      },
    ),
  ];
}

export function createSkillAcquisitionTools(
  runtime: SkillProposalToolRuntime,
  actor: SkillToolActor,
  discovery: SkillDiscoveryState,
): readonly StructuredToolInterface[] {
  return [
    tool(
      async () => {
        discovery.searchedInstalled = true;
        return await runtime.listSkills();
      },
      {
        name: 'search_installed_skills',
        description:
          'Search the compact installed skill library before seeking or authoring another workflow.',
        schema: z.object({}),
      },
    ),
    tool(
      async ({ query, limit = 10 }: { query: string; limit?: number }) => {
        discovery.searchedCatalog = true;
        return await runtime.searchSkillCatalog('clawhub', query, limit);
      },
      {
        name: 'search_skill_catalogs',
        description: 'Search the trusted ClawHub skill catalog for an existing reusable workflow.',
        schema: z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(20).optional().default(10),
        }),
      },
    ),
    tool(async ({ skillId }: { skillId: string }) => await runtime.readSkill(skillId), {
      name: 'inspect_skill_package',
      description: 'Inspect one already-installed skill package and its files.',
      schema: z.object({ skillId: z.string().min(1) }),
    }),
    tool(
      async ({ candidates }: { candidates: readonly ComparisonCandidate[] }) => ({
        candidates: await Promise.all(
          candidates.map(async (candidate) =>
            candidate.sourceType === 'installed'
              ? {
                  sourceType: candidate.sourceType,
                  skillId: candidate.skillId,
                  package: await runtime.readSkill(candidate.skillId),
                }
              : {
                  sourceType: candidate.sourceType,
                  slug: candidate.slug,
                  inspection: await runtime.inspectSkillInstallation({
                    sourceType: 'clawhub',
                    slug: candidate.slug,
                    version: candidate.version,
                  }),
                },
          ),
        ),
      }),
      {
        name: 'compare_skill_candidates',
        description:
          'Return comparable installed-package details and scanned ClawHub candidate metadata before choosing a workflow.',
        schema: z.object({ candidates: z.array(comparisonCandidateSchema).min(2).max(5) }),
      },
    ),
    tool(
      async ({ installation }: { installation: InstallSkillRequest }) =>
        await runtime.inspectSkillInstallation(installation),
      {
        name: 'check_skill_compatibility',
        description:
          'Inspect and scan a ClawHub or Git skill source without installing it or granting capabilities.',
        schema: z.object({ installation: installationSchema }),
      },
    ),
    tool(
      async ({
        installation,
        evidence,
      }: {
        installation: InstallSkillRequest;
        evidence?: string;
      }) => await runtime.proposeSkillInstall({ installation, evidence }, actor),
      {
        name: 'propose_skill_install',
        description:
          'Create a hash-bound installation proposal for explicit user review. This never installs or attaches the skill.',
        schema: z.object({
          installation: installationSchema,
          evidence: z.string().max(4000).optional(),
        }),
      },
    ),
  ];
}

type ComparisonCandidate =
  | { readonly sourceType: 'installed'; readonly skillId: string }
  | { readonly sourceType: 'clawhub'; readonly slug: string; readonly version?: string };
