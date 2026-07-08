import { z } from 'zod';

const agentKindSchema = z.enum(['chat', 'operator', 'internal']);

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
      canWrite: z.boolean().optional(),
    })
    .optional(),
});

export const updateAgentSoulRequestSchema = z.object({
  content: z.string(),
});

export const updateAgentToolsRequestSchema = z.object({
  enabledTools: z.array(z.string().trim().min(1)),
});

const memoryScopeSchema = z.enum(['agent', 'agent_user', 'user']);
const memoryTypeSchema = z.enum([
  'fact',
  'preference',
  'conversation_summary',
  'open_task',
  'tracked_topic',
]);
const memoryStatusSchema = z.enum(['active', 'archived', 'superseded']);
const memoryLifetimeSchema = z.enum(['permanent', 'active', 'temporary']);
const memorySourceSchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  threadId: z.string().uuid().optional(),
  messageId: z.string().trim().min(1).optional(),
  note: z.string().trim().min(1).optional(),
});

export const memoryListQuerySchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  scope: memoryScopeSchema.optional(),
  type: memoryTypeSchema.optional(),
  lifetime: memoryLifetimeSchema.optional(),
  status: memoryStatusSchema.optional(),
  tag: z.string().trim().min(1).optional(),
  createdFrom: z.string().trim().min(1).optional(),
  createdTo: z.string().trim().min(1).optional(),
  updatedFrom: z.string().trim().min(1).optional(),
  updatedTo: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const createMemoryRequestSchema = z.object({
  scope: memoryScopeSchema,
  agentId: z.string().trim().min(1).optional(),
  type: memoryTypeSchema,
  lifetime: memoryLifetimeSchema.optional(),
  content: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).optional(),
  source: memorySourceSchema.optional(),
});

export const updateMemoryRequestSchema = z.object({
  type: memoryTypeSchema.optional(),
  status: memoryStatusSchema.optional(),
  lifetime: memoryLifetimeSchema.optional(),
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

export const agentToolParamsSchema = z.object({
  agentId: z.string().trim().min(1),
  toolId: z.string().trim().min(1),
});

export const threadParamsSchema = z.object({
  agentId: z.string().trim().min(1),
  threadId: z.string().uuid(),
});

export const runParamsSchema = z.object({
  runId: z.string().uuid(),
});

export const threadSummaryRequestSchema = z.object({
  model: z.string().trim().min(1).optional(),
});

export const threadSummariesRequestSchema = threadSummaryRequestSchema.extend({
  limit: z.number().int().min(1).max(500).optional(),
});

export const memoryMaintenanceRequestSchema = threadSummaryRequestSchema.extend({
  agentId: z.string().trim().min(1).optional(),
  limitPerAgent: z.number().int().min(1).max(500).optional(),
});

export const updateMemoryMaintenanceSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(5).max(10080).optional(),
  agentId: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  limitPerAgent: z.number().int().min(1).max(500).optional(),
});

export const agentRunRequestSchema = z.object({
  agentId: z.string().trim().min(1),
  threadId: z.string().uuid(),
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1),
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
