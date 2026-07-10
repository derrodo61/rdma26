import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';

import type {
  DateStylePreference,
  CostSummaryGroupBy,
  LlmCallPurpose,
  LlmCallStatus,
  MemoryLifetime,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  ModelPricingStatus,
  PricingSourceTrustLevel,
  ThemePreference,
  TimeStylePreference,
} from '../../shared/agent-contracts';
import { AssistantRuntime } from './runtime';

config({ quiet: true });

const runtime = new AssistantRuntime();

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  const options = parseOptions(args);

  await runtime.ensureReady();

  switch (command) {
    case 'tools:list':
      printJson(runtime.toolsResponse());
      return;
    case 'agents:list':
      printJson(await runtime.agentsResponse());
      return;
    case 'agents:create':
      printJson(
        await runtime.createAgent({
          id: options['id'],
          name: requiredOption(options, 'name'),
        }),
      );
      return;
    case 'agents:update':
      printJson(
        await runtime.updateAgent(agentId(options), {
          name: requiredOption(options, 'name'),
        }),
      );
      return;
    case 'agents:memory:set': {
      const canRead = parseOptionalBooleanOption(options['can-read'], 'can-read');
      const canWrite = parseOptionalBooleanOption(options['can-write'], 'can-write');

      if (canRead === undefined && canWrite === undefined) {
        throw new Error('Provide --can-read, --can-write, or both.');
      }

      printJson(
        await runtime.updateAgent(agentId(options), {
          memory: {
            canRead,
            canWrite,
          },
        }),
      );
      return;
    }
    case 'agents:model:set':
      printJson(
        await runtime.updateAgent(agentId(options), {
          models: {
            chat: requiredOption(options, 'model'),
          },
        }),
      );
      return;
    case 'agents:research-model:set': {
      const agent = await runtime.readAgent(agentId(options));

      printJson(
        await runtime.updateAgent(agent.id, {
          models: {
            ...agent.models,
            research: {
              ...agent.models.research,
              researcher: requiredOption(options, 'model'),
            },
          },
        }),
      );
      return;
    }
    case 'agents:soul:read':
      printJson(await runtime.readAgentSoul(agentId(options)));
      return;
    case 'agents:soul:write':
      printJson(
        await runtime.updateAgentSoul(agentId(options), {
          content: await readSoulContent(options),
        }),
      );
      return;
    case 'agents:delete':
      printJson(await runtime.deleteAgent(agentId(options)));
      return;
    case 'profile:read':
      printJson(await runtime.readUserProfile());
      return;
    case 'profile:update':
      printJson(
        await runtime.updateUserProfile({
          name: options['name'],
          timeZone: options['time-zone'],
          language: options['language'],
          locale: options['locale'],
          dateStyle: parseDateStyle(options['date-style']),
          timeStyle: parseTimeStyle(options['time-style']),
          theme: parseTheme(options['theme']),
          lastAgentId: options['last-agent'],
        }),
      );
      return;
    case 'profile:agent-model:set': {
      const profile = await runtime.readUserProfile();
      const selectedAgentId = agentId(options);

      printJson(
        await runtime.updateUserProfile({
          agentSettings: {
            ...profile.agentSettings,
            [selectedAgentId]: {
              ...profile.agentSettings[selectedAgentId],
              model: requiredOption(options, 'model'),
            },
          },
        }),
      );
      return;
    }
    case 'memories:list':
      printJson(
        await runtime.listMemories({
          agentId: options['agent'],
          scope: parseMemoryScope(options['scope']),
          type: parseMemoryType(options['type']),
          lifetime: parseMemoryLifetime(options['lifetime']),
          status: parseMemoryStatus(options['status']),
          tag: options['tag'],
          createdFrom: options['created-from'],
          createdTo: options['created-to'],
          updatedFrom: options['updated-from'],
          updatedTo: options['updated-to'],
          query: options['query'],
          limit: parseOptionalInteger(options['limit'], 'limit'),
        }),
      );
      return;
    case 'memories:read':
      printJson(await runtime.readMemory(requiredOption(options, 'memory')));
      return;
    case 'memories:create':
      printJson(
        await runtime.createMemory({
          scope: parseRequiredMemoryScope(options['scope']),
          agentId: options['agent'],
          type: parseRequiredMemoryType(options['type']),
          lifetime: parseMemoryLifetime(options['lifetime']),
          content: await readMemoryContent(options),
          tags: parseOptionalList(options['tags']),
          source: {
            agentId: options['agent'],
            threadId: options['thread'],
            note: options['source-note'] ?? 'Created from CLI.',
          },
        }),
      );
      return;
    case 'memories:update':
      printJson(
        await runtime.updateMemory(requiredOption(options, 'memory'), {
          type: parseMemoryType(options['type']),
          status: parseMemoryStatus(options['status']),
          lifetime: parseMemoryLifetime(options['lifetime']),
          content:
            options['file'] || options['content'] ? await readMemoryContent(options) : undefined,
          tags: options['tags'] ? parseOptionalList(options['tags']) : undefined,
        }),
      );
      return;
    case 'memories:archive':
      printJson(
        await runtime.updateMemory(requiredOption(options, 'memory'), {
          status: 'archived',
        }),
      );
      return;
    case 'memories:delete':
      printJson(await runtime.deleteMemory(requiredOption(options, 'memory')));
      return;
    case 'memories:maintenance':
      printJson(
        await runtime.runMemoryMaintenance({
          agentId: options['agent'],
          model: options['model'],
          limitPerAgent: parseOptionalInteger(options['limit'], 'limit'),
        }),
      );
      return;
    case 'memories:maintenance:settings':
      printJson(await runtime.readMemoryMaintenanceSettings());
      return;
    case 'memories:maintenance:configure':
      printJson(
        await runtime.updateMemoryMaintenanceSettings({
          enabled: parseOptionalBooleanOption(options['enabled'], 'enabled'),
          intervalMinutes: parseOptionalInteger(options['interval-minutes'], 'interval-minutes'),
          agentId: options['agent'],
          model: options['model'],
          limitPerAgent: parseOptionalInteger(options['limit'], 'limit'),
        }),
      );
      return;
    case 'agents:tools':
      printJson(await runtime.agentToolsResponse(agentId(options)));
      return;
    case 'agents:tools:set':
      printJson(
        await runtime.updateAgentTools(agentId(options), {
          enabledTools: parseToolList(requiredOption(options, 'tools')),
        }),
      );
      return;
    case 'agents:tools:grant':
      printJson(await runtime.grantAgentTool(agentId(options), requiredOption(options, 'tool')));
      return;
    case 'agents:tools:revoke':
      printJson(await runtime.revokeAgentTool(agentId(options), requiredOption(options, 'tool')));
      return;
    case 'threads:list':
      printJson(await runtime.listThreads(agentId(options)));
      return;
    case 'threads:create':
      printJson(
        await runtime.createThread(agentId(options), {
          title: options['title'],
        }),
      );
      return;
    case 'threads:read':
      printJson(await runtime.readThread(agentId(options), requiredOption(options, 'thread')));
      return;
    case 'threads:delete':
      printJson(await runtime.deleteThread(agentId(options), requiredOption(options, 'thread')));
      return;
    case 'threads:summary':
      printJson(
        await runtime.consolidateThreadSummary(
          agentId(options),
          requiredOption(options, 'thread'),
          {
            model: options['model'],
          },
        ),
      );
      return;
    case 'threads:summaries':
      printJson(
        await runtime.consolidateAgentThreadSummaries(agentId(options), {
          model: options['model'],
          limit: parseOptionalInteger(options['limit'], 'limit'),
        }),
      );
      return;
    case 'chat:send': {
      const threadId = requiredOption(options, 'thread');
      const model = options['model'] ?? runtime.modelsResponse().defaultModel;
      const prompt = requiredOption(options, 'prompt');
      const result = await runtime.runAgent({
        agentId: agentId(options),
        threadId,
        model,
        prompt,
      });

      printJson(result);
      return;
    }
    case 'optimizer:ask':
      printJson(
        await runtime.runOptimizer({
          prompt: requiredOption(options, 'prompt'),
          model: options['model'],
          title: options['title'],
        }),
      );
      return;
    case 'runs:context':
      printJson(await runtime.readRunContext(requiredOption(options, 'run')));
      return;
    case 'llm-calls:list':
      printJson(
        await runtime.listLlmCalls({
          agentId: options['agent'],
          threadId: options['thread'],
          runId: options['run'],
          provider: options['provider'],
          model: options['model'],
          purpose: parseLlmCallPurpose(options['purpose']),
          status: parseLlmCallStatus(options['status']),
          startedFrom: options['started-from'],
          startedTo: options['started-to'],
          limit: parseOptionalInteger(options['limit'], 'limit'),
        }),
      );
      return;
    case 'llm-calls:show':
      printJson(await runtime.readLlmCall(requiredOption(options, 'call')));
      return;
    case 'costs:summary':
      printJson(
        await runtime.summarizeCosts({
          agentId: options['agent'],
          threadId: options['thread'],
          provider: options['provider'],
          model: options['model'],
          purpose: parseLlmCallPurpose(options['purpose']),
          status: parseLlmCallStatus(options['status']),
          startedFrom: options['started-from'],
          startedTo: options['started-to'],
          groupBy: parseCostSummaryGroupBy(options['group-by']),
        }),
      );
      return;
    case 'pricing:list':
      printJson(
        await runtime.listModelPricing({
          provider: options['provider'],
          model: options['model'],
          status: parseModelPricingStatus(options['status']),
        }),
      );
      return;
    case 'pricing:create':
      printJson(
        await runtime.createModelPricing({
          provider: requiredOption(options, 'provider'),
          model: requiredOption(options, 'model'),
          inputCostPerMillionTokens: parseRequiredNumber(options['input'], 'input'),
          outputCostPerMillionTokens: parseRequiredNumber(options['output'], 'output'),
          cachedInputCostPerMillionTokens: parseOptionalNumber(
            options['cached-input'],
            'cached-input',
          ),
          reasoningCostPerMillionTokens: parseOptionalNumber(options['reasoning'], 'reasoning'),
          currency: options['currency'],
          sourceUrl: requiredOption(options, 'source-url'),
          sourceName: options['source-name'],
          sourceRetrievedAt: options['source-retrieved-at'],
          validFrom: options['valid-from'],
          validUntil: options['valid-until'],
          status: parseModelPricingStatus(options['status']) ?? 'unverified',
          notes: options['notes'],
        }),
      );
      return;
    case 'pricing:activate':
      printJson(
        await runtime.updateModelPricing(requiredOption(options, 'pricing'), {
          status: 'active',
        }),
      );
      return;
    case 'pricing:supersede':
      printJson(
        await runtime.updateModelPricing(requiredOption(options, 'pricing'), {
          status: 'superseded',
          validUntil: options['valid-until'],
        }),
      );
      return;
    case 'pricing-sources:list':
      printJson(
        await runtime.listPricingSources({
          provider: options['provider'],
          trustLevel: parsePricingSourceTrustLevel(options['trust-level']),
          active: parseOptionalBooleanOption(options['active'], 'active'),
        }),
      );
      return;
    case 'pricing-sources:add':
      printJson(
        await runtime.createPricingSource({
          provider: requiredOption(options, 'provider'),
          name: requiredOption(options, 'name'),
          url: requiredOption(options, 'url'),
          trustLevel: parsePricingSourceTrustLevel(options['trust-level']) ?? 'user_added',
          active: parseOptionalBooleanOption(options['active'], 'active'),
          notes: options['notes'],
        }),
      );
      return;
    case 'pricing-sources:update':
      printJson(
        await runtime.updatePricingSource(requiredOption(options, 'source'), {
          provider: options['provider'],
          name: options['name'],
          url: options['url'],
          trustLevel: parsePricingSourceTrustLevel(options['trust-level']),
          active: parseOptionalBooleanOption(options['active'], 'active'),
          notes: options['notes'],
        }),
      );
      return;
    case 'pricing-sources:delete':
      printJson(await runtime.deletePricingSource(requiredOption(options, 'source')));
      return;
    case 'pricing-sources:check':
      printJson(await runtime.checkPricingSource(requiredOption(options, 'source')));
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseOptions(args: readonly string[]): Record<string, string | undefined> {
  const options: Record<string, string | undefined> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf('=');

    if (equalsIndex > -1) {
      options[arg.slice(2, equalsIndex)] = arg.slice(equalsIndex + 1);
      continue;
    }

    const key = arg.slice(2);
    const value = args[index + 1];

    if (!value || value.startsWith('--')) {
      options[key] = 'true';
      continue;
    }

    options[key] = value;
    index += 1;
  }

  return options;
}

function agentId(options: Record<string, string | undefined>): string {
  return options['agent'] ?? runtime.getDefaultAgentId();
}

function parseToolList(input: string): readonly string[] {
  return input
    .split(',')
    .map((toolId) => toolId.trim())
    .filter(Boolean);
}

async function readSoulContent(options: Record<string, string | undefined>): Promise<string> {
  const file = options['file'];
  const content = options['content'];

  if (file && content !== undefined) {
    throw new Error('Use either --file or --content, not both.');
  }

  if (file) {
    return await readFile(file, 'utf8');
  }

  if (content !== undefined) {
    return content;
  }

  throw new Error('Missing required option: --file or --content');
}

async function readMemoryContent(options: Record<string, string | undefined>): Promise<string> {
  const file = options['file'];
  const content = options['content'];

  if (file && content !== undefined) {
    throw new Error('Use either --file or --content, not both.');
  }

  if (file) {
    return await readFile(file, 'utf8');
  }

  if (content !== undefined) {
    return content;
  }

  throw new Error('Missing required option: --file or --content');
}

function parseOptionalList(value: string | undefined): readonly string[] {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parseOptionalInteger(value: string | undefined, name: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`--${name} must be an integer.`);
  }

  return parsed;
}

function parseRequiredNumber(value: string | undefined, name: string): number {
  const parsed = parseOptionalNumber(value, name);

  if (parsed === undefined) {
    throw new Error(`Missing required option: --${name}`);
  }

  return parsed;
}

function parseOptionalNumber(value: string | undefined, name: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a positive number.`);
  }

  return parsed;
}

function parseBooleanOption(value: string, name: string): boolean {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`--${name} must be true or false.`);
}

function parseOptionalBooleanOption(value: string | undefined, name: string): boolean | undefined {
  return value === undefined ? undefined : parseBooleanOption(value, name);
}

function parseRequiredMemoryScope(value: string | undefined): MemoryScope {
  const parsed = parseMemoryScope(value);

  if (!parsed) {
    throw new Error('Missing required option: --scope');
  }

  return parsed;
}

function parseMemoryScope(value: string | undefined): MemoryScope | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'agent' || value === 'agent_user' || value === 'user') {
    return value;
  }

  throw new Error('--scope must be agent, agent_user, or user.');
}

function parseRequiredMemoryType(value: string | undefined): MemoryType {
  const parsed = parseMemoryType(value);

  if (!parsed) {
    throw new Error('Missing required option: --type');
  }

  return parsed;
}

function parseMemoryType(value: string | undefined): MemoryType | undefined {
  if (!value) {
    return undefined;
  }

  if (
    value === 'fact' ||
    value === 'preference' ||
    value === 'conversation_summary' ||
    value === 'open_task' ||
    value === 'tracked_topic'
  ) {
    return value;
  }

  throw new Error(
    '--type must be fact, preference, conversation_summary, open_task, or tracked_topic.',
  );
}

function parseMemoryStatus(value: string | undefined): MemoryStatus | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'active' || value === 'archived' || value === 'superseded') {
    return value;
  }

  throw new Error('--status must be active, archived, or superseded.');
}

function parseMemoryLifetime(value: string | undefined): MemoryLifetime | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'permanent' || value === 'active' || value === 'temporary') {
    return value;
  }

  throw new Error('--lifetime must be permanent, active, or temporary.');
}

function parseModelPricingStatus(value: string | undefined): ModelPricingStatus | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'active' || value === 'superseded' || value === 'unverified') {
    return value;
  }

  throw new Error('--status must be active, superseded, or unverified.');
}

function parsePricingSourceTrustLevel(
  value: string | undefined,
): PricingSourceTrustLevel | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'official' || value === 'third_party' || value === 'user_added') {
    return value;
  }

  throw new Error('--trust-level must be official, third_party, or user_added.');
}

function parseLlmCallPurpose(value: string | undefined): LlmCallPurpose | undefined {
  if (!value) {
    return undefined;
  }

  if (
    value === 'chat' ||
    value === 'research_parent' ||
    value === 'research_subagent' ||
    value === 'research_verification' ||
    value === 'thread_summary' ||
    value === 'memory_retrieval' ||
    value === 'memory_maintenance' ||
    value === 'operator' ||
    value === 'unknown'
  ) {
    return value;
  }

  throw new Error('--purpose is not a known LLM call purpose.');
}

function parseLlmCallStatus(value: string | undefined): LlmCallStatus | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'success' || value === 'error' || value === 'cancelled') {
    return value;
  }

  throw new Error('--status must be success, error, or cancelled.');
}

function parseCostSummaryGroupBy(value: string | undefined): CostSummaryGroupBy | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'day' || value === 'agent' || value === 'model' || value === 'purpose') {
    return value;
  }

  throw new Error('--group-by must be day, agent, model, or purpose.');
}

function parseTheme(value: string | undefined): ThemePreference | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  throw new Error('--theme must be light, dark, or system.');
}

function parseDateStyle(value: string | undefined): DateStylePreference | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'short' || value === 'medium' || value === 'long' || value === 'full') {
    return value;
  }

  throw new Error('--date-style must be short, medium, long, or full.');
}

function parseTimeStyle(value: string | undefined): TimeStylePreference | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'short' || value === 'medium') {
    return value;
  }

  throw new Error('--time-style must be short or medium.');
}

function requiredOption(options: Record<string, string | undefined>, key: string): string {
  const value = options[key]?.trim();

  if (!value) {
    throw new Error(`Missing required option: --${key}`);
  }

  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`rdma26 CLI

Usage:
  rdma26 tools:list
  rdma26 agents:list
  rdma26 agents:create --id research --name "Research assistant"
  rdma26 agents:update --agent research --name "Researcher"
  rdma26 agents:memory:set --agent research --can-read true --can-write true
  rdma26 agents:model:set --agent research --model gpt-4.1-mini
  rdma26 agents:research-model:set --agent research --model gpt-4.1-mini
  rdma26 agents:soul:read --agent research
  rdma26 agents:soul:write --agent research --file ./soul.md
  rdma26 agents:delete --agent research
  rdma26 profile:read
  rdma26 profile:update --name "Rolf" --time-zone Europe/Berlin --locale de-DE --language de --date-style medium --time-style short --theme system --last-agent ronaldo
  rdma26 profile:agent-model:set --agent scotty --model gpt-4.1-mini
  rdma26 memories:list --agent scotty --query "football" --tag project --updated-from 2026-07-01
  rdma26 memories:create --agent scotty --scope agent --type fact --content "The user prefers concise updates."
  rdma26 memories:update --memory <memory-id> --content "Updated memory"
  rdma26 memories:archive --memory <memory-id>
  rdma26 memories:delete --memory <memory-id>
  rdma26 memories:maintenance --agent scotty --limit 25
  rdma26 memories:maintenance:settings
  rdma26 memories:maintenance:configure --enabled true --interval-minutes 1440 --limit 25
  rdma26 agents:tools --agent research
  rdma26 agents:tools:set --agent research --tools internet_search
  rdma26 agents:tools:grant --agent research --tool internet_search
  rdma26 agents:tools:revoke --agent research --tool internet_search
  rdma26 threads:list --agent scotty
  rdma26 threads:create --agent scotty --title "Planning"
  rdma26 threads:read --agent scotty --thread <thread-id>
  rdma26 threads:delete --agent scotty --thread <thread-id>
  rdma26 threads:summary --agent scotty --thread <thread-id>
  rdma26 threads:summaries --agent scotty --limit 25
  rdma26 chat:send --agent scotty --thread <thread-id> --model gpt-4.1-mini --prompt "Hello"
  rdma26 optimizer:ask --prompt "Which agent cost the most this week?"
  rdma26 runs:context --run <run-id>
  rdma26 llm-calls:list --agent scotty --limit 20
  rdma26 llm-calls:show --call <call-id>
  rdma26 costs:summary --started-from 2026-07-01 --group-by model
  rdma26 pricing:list --provider openai --model gpt-4.1-mini
  rdma26 pricing:create --provider openai --model gpt-4.1-mini --input 0.40 --output 1.60 --source-url "https://developers.openai.com/api/docs/pricing" --status active
  rdma26 pricing:activate --pricing <pricing-id>
  rdma26 pricing:supersede --pricing <pricing-id>
  rdma26 pricing-sources:list --provider openai --active true
  rdma26 pricing-sources:add --provider openai --name "OpenAI API pricing" --url "https://developers.openai.com/api/docs/pricing" --trust-level official
  rdma26 pricing-sources:update --source <source-id> --active false
  rdma26 pricing-sources:delete --source <source-id>
  rdma26 pricing-sources:check --source <source-id>

Options:
  --agent   Agent id. Defaults to ASSISTANT_AGENT_ID or scotty.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'CLI command failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
