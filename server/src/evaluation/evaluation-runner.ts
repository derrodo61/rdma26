import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AgentProfile,
  LlmCallRecord,
  MemoryRecord,
  RunContextToolCall,
} from '../../../shared/agent-contracts';
import type { AssistantRuntime } from '../runtime';
import {
  evaluationSuiteVersion,
  selectEvaluationCases,
  type EvaluationAssertions,
  type EvaluationCaseDefinition,
  type EvaluationMemorySeed,
  type EvaluationStep,
  type EvaluationSuiteId,
} from './evaluation-cases';

export interface EvaluationRunOptions {
  readonly suite?: EvaluationSuiteId;
  readonly caseIds?: readonly string[];
  readonly model?: string;
  readonly keepData?: boolean;
}

export interface EvaluationReport {
  readonly id: string;
  readonly suiteVersion: string;
  readonly suite: EvaluationSuiteId;
  readonly model: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status: 'passed' | 'failed' | 'review';
  readonly summary: EvaluationSummary;
  readonly cases: readonly EvaluationCaseResult[];
  readonly reportPath: string;
  readonly retainedAgentIds?: readonly string[];
}

export interface EvaluationSummary {
  readonly caseCount: number;
  readonly passed: number;
  readonly failed: number;
  readonly review: number;
  readonly runCount: number;
  readonly llmCallCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly maxInputTokensPerCall: number;
  readonly unpricedCallCount: number;
  readonly estimatedCosts: Readonly<Record<string, number>>;
}

export interface EvaluationCaseResult {
  readonly id: string;
  readonly category: EvaluationCaseDefinition['category'];
  readonly description: string;
  readonly status: 'passed' | 'failed' | 'review';
  readonly failures: readonly string[];
  readonly humanReview: readonly string[];
  readonly runs: readonly EvaluationStepResult[];
  readonly metrics: EvaluationRunMetrics;
}

export interface EvaluationStepResult {
  readonly stepId: string;
  readonly agentId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly prompt: string;
  readonly response: string;
  readonly sourceUrls: readonly string[];
  readonly toolCalls: readonly string[];
  readonly failures: readonly string[];
  readonly durationMs: number;
  readonly metrics: EvaluationRunMetrics;
}

export interface EvaluationRunMetrics {
  readonly runCount: number;
  readonly llmCallCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly maxInputTokensPerCall: number;
  readonly unpricedCallCount: number;
  readonly estimatedCosts: Readonly<Record<string, number>>;
}

interface EvaluationAgents {
  readonly primary: AgentProfile;
  readonly secondary: AgentProfile;
}

export async function runEvaluationSuite(
  runtime: AssistantRuntime,
  options: EvaluationRunOptions = {},
): Promise<EvaluationReport> {
  const suite = options.suite ?? 'smoke';
  const definitions = selectEvaluationCases(suite, options.caseIds);
  const started = new Date();
  const reportId = `evaluation-${formatFileTimestamp(started)}-${crypto.randomUUID().slice(0, 8)}`;
  const model = options.model ?? runtime.modelsResponse().defaultModel;
  const requiredCapabilities = Array.from(
    new Set(definitions.flatMap((definition) => definition.requiredCapabilities)),
  );

  await assertRequirements(runtime, requiredCapabilities);
  const agents = await createEvaluationAgents(runtime, reportId, model, requiredCapabilities);
  const caseResults: EvaluationCaseResult[] = [];
  const retainedAgentIds = [agents.primary.id, agents.secondary.id];

  try {
    for (const definition of definitions) {
      caseResults.push(await runEvaluationCase(runtime, definition, agents, model));
    }
  } finally {
    if (!options.keepData) {
      await deleteEvaluationAgent(runtime, agents.secondary.id);
      await deleteEvaluationAgent(runtime, agents.primary.id);
    }
  }

  const finished = new Date();
  const summary = summarizeCases(caseResults);
  const health = await runtime.health();
  const reportPath = join(health.dataDir, 'evaluations', `${reportId}.json`);
  const report: EvaluationReport = {
    id: reportId,
    suiteVersion: evaluationSuiteVersion,
    suite,
    model,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    status: summary.failed ? 'failed' : summary.review ? 'review' : 'passed',
    summary,
    cases: caseResults,
    reportPath,
    ...(options.keepData ? { retainedAgentIds } : {}),
  };

  await mkdir(join(health.dataDir, 'evaluations'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return report;
}

async function assertRequirements(
  runtime: AssistantRuntime,
  requiredCapabilities: readonly string[],
): Promise<void> {
  const health = await runtime.health();

  if (!health.apiKeyConfigured) {
    throw new Error('OPENAI_API_KEY is required to run live evaluations.');
  }

  const definitions = new Map(runtime.toolsResponse().tools.map((tool) => [tool.id, tool]));
  const unavailable = requiredCapabilities.filter(
    (capabilityId) => !definitions.get(capabilityId)?.available,
  );

  if (unavailable.length) {
    throw new Error(`Evaluation capabilities are unavailable: ${unavailable.join(', ')}.`);
  }
}

async function createEvaluationAgents(
  runtime: AssistantRuntime,
  reportId: string,
  model: string,
  requiredCapabilities: readonly string[],
): Promise<EvaluationAgents> {
  const suffix = reportId.slice(-8);
  const primary = await runtime.createAgent({
    id: `eval-primary-${suffix}`,
    name: `Evaluation Primary ${suffix}`,
    kind: 'chat',
    chatEnabled: false,
  });
  const secondary = await runtime.createAgent({
    id: `eval-secondary-${suffix}`,
    name: `Evaluation Secondary ${suffix}`,
    kind: 'chat',
    chatEnabled: false,
  });
  const soul = [
    '# Evaluation agent',
    '',
    'You are a neutral rdma26 evaluation agent.',
    'Answer the user directly and accurately.',
    'Use granted capabilities when the question requires them.',
    'Do not invent missing facts or claim certainty without evidence.',
  ].join('\n');

  for (const agent of [primary, secondary]) {
    await runtime.updateAgent(agent.id, {
      memory: { canRead: true, canWrite: false },
      models: {
        chat: model,
        research: { researcher: model },
      },
    });
    await runtime.updateAgentSoul(agent.id, { content: soul });
    await runtime.updateAgentTools(agent.id, { enabledTools: requiredCapabilities });
  }

  return {
    primary: await runtime.readAgent(primary.id),
    secondary: await runtime.readAgent(secondary.id),
  };
}

async function runEvaluationCase(
  runtime: AssistantRuntime,
  definition: EvaluationCaseDefinition,
  agents: EvaluationAgents,
  model: string,
): Promise<EvaluationCaseResult> {
  const memories: MemoryRecord[] = [];
  const threads = new Map<string, string>();
  const runs: EvaluationStepResult[] = [];

  try {
    for (const seed of definition.memorySeeds ?? []) {
      memories.push(await createMemorySeed(runtime, seed, agents));
    }

    for (const step of definition.steps) {
      runs.push(await runEvaluationStep(runtime, definition, step, agents, model, threads));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runs.push({
      stepId: 'runtime-error',
      agentId: agents.primary.id,
      threadId: '',
      runId: '',
      prompt: '',
      response: '',
      sourceUrls: [],
      toolCalls: [],
      failures: [`Evaluation runtime error: ${message}`],
      durationMs: 0,
      metrics: emptyMetrics(),
    });
  } finally {
    for (const memory of memories) {
      await runtime.deleteMemory(memory.id);
    }
  }

  const scoredRuns = runs.filter((run) => {
    const step = definition.steps.find((candidate) => candidate.id === run.stepId);
    return step?.includeInScore !== false;
  });
  const failures = scoredRuns.flatMap((run) => run.failures);
  const humanReview = failures.length ? [] : [...(definition.humanReview ?? [])];

  return {
    id: definition.id,
    category: definition.category,
    description: definition.description,
    status: failures.length ? 'failed' : humanReview.length ? 'review' : 'passed',
    failures,
    humanReview,
    runs,
    metrics: summarizeMetrics(runs.map((run) => run.metrics)),
  };
}

async function createMemorySeed(
  runtime: AssistantRuntime,
  seed: EvaluationMemorySeed,
  agents: EvaluationAgents,
): Promise<MemoryRecord> {
  const agentId = seed.scope === 'user' ? undefined : agents[seed.agent].id;

  return await runtime.createMemory({
    scope: seed.scope,
    agentId,
    pinned: seed.pinned ?? false,
    content: seed.content,
    tags: seed.tags,
    source: {
      agentId,
      note: 'Created by the rdma26 evaluation harness.',
    },
  });
}

async function runEvaluationStep(
  runtime: AssistantRuntime,
  definition: EvaluationCaseDefinition,
  step: EvaluationStep,
  agents: EvaluationAgents,
  model: string,
  threads: Map<string, string>,
): Promise<EvaluationStepResult> {
  const agent = agents[step.agent];
  const threadKey = `${step.agent}:${step.thread}`;
  let threadId = threads.get(threadKey);

  if (!threadId) {
    const thread = await runtime.createThread(agent.id, {
      title: `Evaluation: ${definition.id} (${step.thread})`,
    });
    threadId = thread.id;
    threads.set(threadKey, threadId);
  }

  const started = Date.now();
  const result = await runtime.runAgent({
    agentId: agent.id,
    threadId,
    model,
    prompt: step.prompt,
  });
  const durationMs = Date.now() - started;
  const calls = result.runContext.llmCalls ?? [];
  const runToolCalls = result.runContext.toolCalls ?? [];
  const sourceUrls = extractSourceUrls(runToolCalls);
  const toolCalls = runToolCalls
    .map((toolCall) => toolCall.name)
    .filter((name): name is string => Boolean(name));
  const failures = evaluateAssertions(
    result.agentResponse.content,
    sourceUrls,
    toolCalls,
    step.assertions,
  );

  return {
    stepId: step.id,
    agentId: agent.id,
    threadId,
    runId: result.runId,
    prompt: step.prompt,
    response: result.agentResponse.content,
    sourceUrls,
    toolCalls,
    failures,
    durationMs,
    metrics: metricsForCalls(calls),
  };
}

export function evaluateAssertions(
  response: string,
  sourceUrls: readonly string[],
  toolCalls: readonly string[],
  assertions: EvaluationAssertions,
): readonly string[] {
  const failures: string[] = [];
  const normalizeText = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"');
  const normalizedResponse = normalizeText(response);
  const includes = (value: string) => normalizedResponse.includes(normalizeText(value));

  for (const value of assertions.containsAll ?? []) {
    if (!includes(value)) failures.push(`Response does not contain required text: ${value}`);
  }

  if (assertions.containsAny?.length && !assertions.containsAny.some(includes)) {
    failures.push(`Response contains none of: ${assertions.containsAny.join(', ')}`);
  }

  for (const value of assertions.excludesAll ?? []) {
    if (includes(value)) failures.push(`Response contains forbidden text: ${value}`);
  }

  if ((assertions.minimumSources ?? 0) > sourceUrls.length) {
    failures.push(
      `Expected at least ${assertions.minimumSources} sources, received ${sourceUrls.length}.`,
    );
  }

  const sourceDomains = new Set(sourceUrls.map(readUrlDomain));
  const acceptedDomains = assertions.sourceDomainsAny ?? [];
  if (
    acceptedDomains.length &&
    !acceptedDomains.some((domain) =>
      [...sourceDomains].some(
        (candidate) => candidate === domain || candidate.endsWith(`.${domain}`),
      ),
    )
  ) {
    failures.push(`No source was returned from any accepted domain: ${acceptedDomains.join(', ')}`);
  }

  for (const toolName of assertions.requiredToolCalls ?? []) {
    if (!toolCalls.includes(toolName)) failures.push(`Required tool was not called: ${toolName}`);
  }

  for (const toolName of assertions.forbiddenToolCalls ?? []) {
    if (toolCalls.includes(toolName)) failures.push(`Forbidden tool was called: ${toolName}`);
  }

  return failures;
}

function extractSourceUrls(toolCalls: readonly RunContextToolCall[]): readonly string[] {
  const urls = new Set<string>();

  for (const toolCall of toolCalls) {
    visitStructuredValue(toolCall.result, urls, 0);
  }

  return [...urls];
}

function visitStructuredValue(value: unknown, urls: Set<string>, depth: number): void {
  if (depth > 10 || value === null || value === undefined) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;

    try {
      visitStructuredValue(JSON.parse(trimmed) as unknown, urls, depth + 1);
    } catch {
      return;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) visitStructuredValue(item, urls, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;

  for (const [key, candidate] of Object.entries(value)) {
    if (key === 'answerSourceUrls' && Array.isArray(candidate)) {
      for (const url of candidate) {
        if (typeof url === 'string' && isHttpUrl(url)) urls.add(url);
      }
    }
    visitStructuredValue(candidate, urls, depth + 1);
  }
}

function metricsForCalls(calls: readonly LlmCallRecord[]): EvaluationRunMetrics {
  const estimatedCosts: Record<string, number> = {};
  let unpricedCallCount = 0;

  for (const call of calls) {
    if (call.estimatedTotalCost === undefined || !call.estimatedCostCurrency) {
      unpricedCallCount += 1;
      continue;
    }
    estimatedCosts[call.estimatedCostCurrency] =
      (estimatedCosts[call.estimatedCostCurrency] ?? 0) + call.estimatedTotalCost;
  }

  return {
    runCount: 1,
    llmCallCount: calls.length,
    inputTokens: sum(calls, (call) => call.inputTokens),
    outputTokens: sum(calls, (call) => call.outputTokens),
    cachedInputTokens: sum(calls, (call) => call.cachedInputTokens),
    maxInputTokensPerCall: Math.max(0, ...calls.map((call) => call.inputTokens ?? 0)),
    unpricedCallCount,
    estimatedCosts,
  };
}

function summarizeCases(cases: readonly EvaluationCaseResult[]): EvaluationSummary {
  const metrics = summarizeMetrics(cases.map((result) => result.metrics));

  return {
    caseCount: cases.length,
    passed: cases.filter((result) => result.status === 'passed').length,
    failed: cases.filter((result) => result.status === 'failed').length,
    review: cases.filter((result) => result.status === 'review').length,
    ...metrics,
  };
}

function summarizeMetrics(metrics: readonly EvaluationRunMetrics[]): EvaluationRunMetrics {
  const estimatedCosts: Record<string, number> = {};

  for (const metric of metrics) {
    for (const [currency, value] of Object.entries(metric.estimatedCosts)) {
      estimatedCosts[currency] = (estimatedCosts[currency] ?? 0) + value;
    }
  }

  return {
    runCount: metrics.reduce((total, metric) => total + metric.runCount, 0),
    llmCallCount: metrics.reduce((total, metric) => total + metric.llmCallCount, 0),
    inputTokens: metrics.reduce((total, metric) => total + metric.inputTokens, 0),
    outputTokens: metrics.reduce((total, metric) => total + metric.outputTokens, 0),
    cachedInputTokens: metrics.reduce((total, metric) => total + metric.cachedInputTokens, 0),
    maxInputTokensPerCall: Math.max(0, ...metrics.map((metric) => metric.maxInputTokensPerCall)),
    unpricedCallCount: metrics.reduce((total, metric) => total + metric.unpricedCallCount, 0),
    estimatedCosts,
  };
}

function emptyMetrics(): EvaluationRunMetrics {
  return {
    runCount: 0,
    llmCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    maxInputTokensPerCall: 0,
    unpricedCallCount: 0,
    estimatedCosts: {},
  };
}

function sum(calls: readonly LlmCallRecord[], select: (call: LlmCallRecord) => number | undefined) {
  return calls.reduce((total, call) => total + (select(call) ?? 0), 0);
}

function readUrlDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function deleteEvaluationAgent(runtime: AssistantRuntime, agentId: string): Promise<void> {
  try {
    await runtime.deleteAgent(agentId);
  } catch {
    // Preserve the original evaluation failure when cleanup encounters an already removed agent.
  }
}

function formatFileTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
