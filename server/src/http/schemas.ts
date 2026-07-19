import { z } from 'zod';

const agentKindSchema = z.enum(['chat', 'operator', 'internal']);
const agentModelSettingsSchema = z.object({
  chat: z.string().trim().min(1).optional(),
});

export const createAgentRequestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  kind: agentKindSchema.optional(),
  chatEnabled: z.boolean().optional(),
});

export const createThreadRequestSchema = z.object({
  title: z.string().trim().min(1).optional(),
});

export const updateAgentRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  kind: agentKindSchema.optional(),
  chatEnabled: z.boolean().optional(),
  memory: z
    .object({
      canRead: z.boolean().optional(),
      canWrite: z.boolean().optional(),
    })
    .optional(),
  models: agentModelSettingsSchema.optional(),
});

export const updateAgentSoulRequestSchema = z.object({
  content: z.string(),
});

export const updateAgentCapabilitiesRequestSchema = z.object({
  enabledCapabilities: z.array(z.string().trim().min(1)),
});

const skillIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);

export const skillParamsSchema = z.object({
  skillId: skillIdSchema,
});

export const agentSkillParamsSchema = z.object({
  agentId: z.string().trim().min(1),
  skillId: skillIdSchema,
});

export const updateAgentSkillsRequestSchema = z.object({
  attachedSkillIds: z
    .array(skillIdSchema)
    .refine((ids) => new Set(ids).size === ids.length, 'Skill ids must be unique.'),
});

const enabledCapabilitiesSchema = z.array(z.string().trim().min(1)).optional();

export const installSkillRequestSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('local-directory'),
    path: z.string().trim().min(1),
    enabledCapabilities: enabledCapabilitiesSchema,
  }),
  z.object({
    sourceType: z.literal('local-archive'),
    path: z.string().trim().min(1),
    enabledCapabilities: enabledCapabilitiesSchema,
  }),
  z.object({
    sourceType: z.literal('git'),
    repositoryUrl: z.string().trim().min(1),
    packagePath: z.string().trim().min(1).optional(),
    revision: z.string().trim().min(1).optional(),
    enabledCapabilities: enabledCapabilitiesSchema,
  }),
  z.object({
    sourceType: z.literal('clawhub'),
    slug: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
    enabledCapabilities: enabledCapabilitiesSchema,
  }),
]);

export const inspectSkillUpdateRequestSchema = z.object({
  enabledCapabilities: enabledCapabilitiesSchema,
});

export const applySkillUpdateRequestSchema = inspectSkillUpdateRequestSchema.extend({
  expectedContentHash: z.string().trim().min(1),
});

export const setSkillPinnedRequestSchema = z.object({
  pinned: z.boolean(),
});

export const rollbackSkillRequestSchema = z.object({
  contentHash: z.string().trim().min(1).optional(),
});

export const skillCatalogParamsSchema = z.object({
  catalogId: z.string().trim().min(1),
});

export const skillCatalogSearchQuerySchema = z.object({
  query: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const memoryScopeSchema = z.enum(['agent', 'agent_user', 'user']);
const pricingSourceTrustLevelSchema = z.enum(['official', 'third_party', 'user_added']);
const booleanQuerySchema = z.union([z.boolean(), z.enum(['true', 'false'])]);
const memorySourceSchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  threadId: z.string().uuid().optional(),
  messageId: z.string().trim().min(1).optional(),
  note: z.string().trim().min(1).optional(),
});

export const memoryListQuerySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  scope: memoryScopeSchema.optional(),
  pinned: booleanQuerySchema.optional(),
  tag: z.string().trim().min(1).optional(),
  createdFrom: z.string().trim().min(1).optional(),
  createdTo: z.string().trim().min(1).optional(),
  updatedFrom: z.string().trim().min(1).optional(),
  updatedTo: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const memoryBudgetQuerySchema = z.object({
  agentId: z.string().trim().min(1),
});

export const createMemoryRequestSchema = z.object({
  scope: memoryScopeSchema,
  agentId: z.string().trim().min(1).optional(),
  pinned: z.boolean().optional(),
  content: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).optional(),
  source: memorySourceSchema.optional(),
});

export const updateMemoryRequestSchema = z.object({
  pinned: z.boolean().optional(),
  content: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  source: memorySourceSchema.optional(),
});

export const agentParamsSchema = z.object({
  agentId: z.string().trim().min(1),
});

export const memoryParamsSchema = z.object({
  memoryId: z.string().uuid(),
});

export const agentCapabilityParamsSchema = z.object({
  agentId: z.string().trim().min(1),
  capabilityId: z.string().trim().min(1),
});

export const threadParamsSchema = z.object({
  agentId: z.string().trim().min(1),
  threadId: z.string().uuid(),
});

export const runParamsSchema = z.object({
  runId: z.string().uuid(),
});

export const agentRunRequestSchema = z.object({
  agentId: z.string().trim().min(1),
  threadId: z.string().uuid(),
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
});

export const optimizerRunRequestSchema = z.object({
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
});

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const agentSettingsSchema = z.object({
  model: z.string().trim().min(1).optional(),
});

export const updateUserProfileRequestSchema = z.object({
  name: z.string().trim().optional(),
  timeZone: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
  locale: z.string().trim().min(1).optional(),
  dateStyle: z.enum(['short', 'medium', 'long', 'full']).optional(),
  timeStyle: z.enum(['short', 'medium']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  lastAgentId: z.string().trim().min(1).optional(),
  agentSettings: z.record(z.string(), agentSettingsSchema).optional(),
});

const modelPricingStatusSchema = z.enum(['active', 'inactive']);
const llmCallPurposeSchema = z.enum([
  'chat',
  'thread_summary',
  'memory_retrieval',
  'memory_maintenance',
  'operator',
  'unknown',
]);
const llmCallStatusSchema = z.enum(['success', 'error', 'cancelled']);

export const llmCallListQuerySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  threadId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  purpose: llmCallPurposeSchema.optional(),
  status: llmCallStatusSchema.optional(),
  startedFrom: z.string().trim().min(1).optional(),
  startedTo: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const llmCallParamsSchema = z.object({
  callId: z.string().uuid(),
});

export const costSummaryQuerySchema = llmCallListQuerySchema
  .omit({
    limit: true,
    runId: true,
  })
  .extend({
    groupBy: z.enum(['day', 'agent', 'model', 'purpose']).optional(),
  });

export const modelPricingListQuerySchema = z.object({
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  status: modelPricingStatusSchema.optional(),
});

export const createModelPricingRequestSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  inputCostPerMillionTokens: z.number().min(0),
  outputCostPerMillionTokens: z.number().min(0),
  cachedInputCostPerMillionTokens: z.number().min(0).optional(),
  reasoningCostPerMillionTokens: z.number().min(0).optional(),
  currency: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().url(),
  sourceName: z.string().trim().min(1).optional(),
  sourceRetrievedAt: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
});

export const updateModelPricingRequestSchema = z.object({
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  inputCostPerMillionTokens: z.number().min(0).optional(),
  outputCostPerMillionTokens: z.number().min(0).optional(),
  cachedInputCostPerMillionTokens: z.number().min(0).nullable().optional(),
  reasoningCostPerMillionTokens: z.number().min(0).nullable().optional(),
  currency: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().url().optional(),
  sourceName: z.string().trim().min(1).nullable().optional(),
  sourceRetrievedAt: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).nullable().optional(),
});

export const setModelPricingActiveRequestSchema = z.object({
  active: z.boolean(),
});

export const syncOpenAiModelPricingRequestSchema = z.object({
  sourceId: z.string().uuid().optional(),
  apply: z.boolean().optional(),
});

export const modelPricingParamsSchema = z.object({
  pricingId: z.string().uuid(),
});

export const pricingSourceListQuerySchema = z.object({
  provider: z.string().trim().min(1).optional(),
  trustLevel: pricingSourceTrustLevelSchema.optional(),
  active: booleanQuerySchema.optional(),
});

export const createPricingSourceRequestSchema = z.object({
  provider: z.string().trim().min(1),
  name: z.string().trim().min(1),
  url: z.string().trim().url(),
  trustLevel: pricingSourceTrustLevelSchema.optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().min(1).optional(),
});

export const updatePricingSourceRequestSchema = z.object({
  provider: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  url: z.string().trim().url().optional(),
  trustLevel: pricingSourceTrustLevelSchema.optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().min(1).optional(),
});

export const pricingSourceParamsSchema = z.object({
  sourceId: z.string().uuid(),
});
