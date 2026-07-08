import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent, FilesystemBackend, type SubAgent } from 'deepagents';
import { MemorySaver } from '@langchain/langgraph';
import type { StructuredToolInterface } from '@langchain/core/tools';

import type {
  ChatMessage,
  MemoryRecord,
  RunContextTokenUsage,
  RunContextToolCall,
  UserProfile,
} from '../../shared/agent-contracts';
import { createResearchSubagents } from './research-agent';
import type { AssistantStorage } from './storage';
import { researchToolId } from './tools/tool-registry';
import { TavilySearchProvider } from './tools/tavily-search-provider';

interface PersonalAgentRequest {
  readonly threadId: string;
  readonly model: string;
  readonly tools: readonly StructuredToolInterface[];
  readonly enabledToolIds: readonly string[];
  readonly isOperatorAgent: boolean;
  readonly userProfile: UserProfile;
  readonly soulContent: string;
  readonly memories: readonly MemoryRecord[];
  readonly memoryWritesEnabled: boolean;
  readonly messages: readonly ChatMessage[];
  readonly prompt: string;
  readonly onActivity?: AgentActivityCallback;
}

export interface PersonalAgentResponse {
  readonly content: string;
  readonly usedFallback: boolean;
  readonly toolCalls: readonly RunContextToolCall[];
  readonly tokenUsage?: RunContextTokenUsage;
}

type AgentActivityCallback = (activity: {
  readonly label: string;
  readonly detail?: string;
}) => void;

export class PersonalAgent {
  private readonly checkpointer = new MemorySaver();

  constructor(private readonly storage: AssistantStorage) {}

  async run(request: PersonalAgentRequest): Promise<PersonalAgentResponse> {
    if (!process.env['OPENAI_API_KEY']) {
      return {
        content: [
          'OpenAI is not configured yet, so this is the local backend fallback.',
          '',
          `I stored your message in thread ${request.threadId}.`,
          `The ${this.storage.agent.name} identity file is ready at ${this.storage.soulPath}.`,
          '',
          'Set OPENAI_API_KEY in .env and restart the backend to use Deep Agents with OpenAI.',
        ].join('\n'),
        usedFallback: true,
        toolCalls: [],
      };
    }

    const agent = createDeepAgent({
      model: new ChatOpenAI({
        apiKey: process.env['OPENAI_API_KEY'],
        model: request.model,
      }),
      backend: new FilesystemBackend({
        rootDir: this.storage.deepAgentRootDir,
        virtualMode: true,
      }),
      tools: request.tools,
      subagents: createEnabledSubagents(request.enabledToolIds, request.userProfile),
      checkpointer: this.checkpointer,
      systemPrompt: createBootloaderPromptForTest(
        this.storage.agent,
        request.userProfile,
        request.isOperatorAgent,
        request.soulContent,
        request.memories,
        request.memoryWritesEnabled,
        request.enabledToolIds,
      ),
    });

    emitActivity(request.onActivity, {
      label: `${this.storage.agent.name} is preparing the run`,
    });
    const run = await agent.streamEvents(
      {
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      },
      {
        version: 'v3',
        configurable: {
          thread_id: request.threadId,
        },
      },
    );
    const activityObserver = observeAgentRunActivity(run, request.onActivity);
    const result: unknown = await run.output;
    await waitForActivityObserver(activityObserver);

    emitActivity(request.onActivity, {
      label: `${this.storage.agent.name} is writing the answer`,
    });

    return {
      content: extractText(result),
      usedFallback: false,
      toolCalls: extractToolCalls(result),
      tokenUsage: extractTokenUsage(result),
    };
  }
}

async function observeAgentRunActivity(
  run: AgentRunStreamLike,
  onActivity?: AgentActivityCallback,
): Promise<void> {
  if (!onActivity) {
    return;
  }

  await Promise.allSettled([
    observeToolCalls(run.toolCalls, onActivity),
    observeSubagents(run.subagents, onActivity),
  ]);
}

async function observeToolCalls(
  toolCalls: AsyncIterable<ToolCallStreamLike> | undefined,
  onActivity: AgentActivityCallback,
): Promise<void> {
  if (!toolCalls) {
    return;
  }

  for await (const toolCall of toolCalls) {
    if (toolCall.name === 'task') {
      const subagentType = readStringProperty(toolCall.input, 'subagent_type');
      emitActivity(onActivity, {
        label: subagentType
          ? `Delegated work to ${formatSubagentName(subagentType)}`
          : 'Delegated work to a subagent',
      });
    } else {
      emitActivity(onActivity, {
        label: `Using ${formatToolName(toolCall.name)}`,
      });
    }
  }
}

async function observeSubagents(
  subagents: AsyncIterable<SubagentRunStreamLike> | undefined,
  onActivity: AgentActivityCallback,
): Promise<void> {
  if (!subagents) {
    return;
  }

  for await (const subagent of subagents) {
    const subagentName = formatSubagentName(subagent.name);
    emitActivity(onActivity, {
      label: `${subagentName} started`,
    });

    void observeSubagentToolCalls(subagent, onActivity);
    void subagent.output.then(
      () =>
        emitActivity(onActivity, {
          label: `${subagentName} returned findings`,
        }),
      () =>
        emitActivity(onActivity, {
          label: `${subagentName} stopped with an error`,
        }),
    );
  }
}

async function observeSubagentToolCalls(
  subagent: SubagentRunStreamLike,
  onActivity: AgentActivityCallback,
): Promise<void> {
  for await (const toolCall of subagent.toolCalls ?? []) {
    if (toolCall.name === 'research_web_search') {
      emitActivity(onActivity, {
        label: 'Researcher is searching the web',
        detail: readStringProperty(toolCall.input, 'query'),
      });
      continue;
    }

    if (toolCall.name === 'research_read_web_page') {
      emitActivity(onActivity, {
        label: 'Researcher is reading a source',
        detail: readStringProperty(toolCall.input, 'url'),
      });
      continue;
    }

    emitActivity(onActivity, {
      label: `${formatSubagentName(subagent.name)} is using ${formatToolName(toolCall.name)}`,
    });
  }
}

async function waitForActivityObserver(observer: Promise<void>): Promise<void> {
  await Promise.race([
    observer,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 1_000);
    }),
  ]);
}

function emitActivity(
  onActivity: AgentActivityCallback | undefined,
  activity: { readonly label: string; readonly detail?: string },
): void {
  onActivity?.(activity);
}

function formatSubagentName(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ');
}

function readStringProperty(value: unknown, key: string): string | undefined {
  const property = readProperty<unknown>(value, key);

  return typeof property === 'string' && property.trim() ? property : undefined;
}

interface AgentRunStreamLike {
  readonly output: Promise<unknown>;
  readonly toolCalls?: AsyncIterable<ToolCallStreamLike>;
  readonly subagents?: AsyncIterable<SubagentRunStreamLike>;
}

interface SubagentRunStreamLike {
  readonly name: string;
  readonly output: Promise<unknown>;
  readonly toolCalls?: AsyncIterable<ToolCallStreamLike>;
}

interface ToolCallStreamLike {
  readonly name: string;
  readonly input: unknown;
}

function createEnabledSubagents(
  enabledToolIds: readonly string[],
  userProfile: UserProfile,
): readonly SubAgent[] {
  if (!enabledToolIds.includes(researchToolId)) {
    return [];
  }

  const tavilyApiKey = process.env['TAVILY_API_KEY'];

  if (!tavilyApiKey) {
    throw new Error('TAVILY_API_KEY is required to use the research capability.');
  }

  return createResearchSubagents(new TavilySearchProvider(tavilyApiKey), userProfile);
}

export function createBootloaderPromptForTest(
  agent: { name: string; soulVirtualPath: string },
  userProfile: UserProfile,
  isOperatorAgent: boolean,
  soulContent: string,
  memories: readonly MemoryRecord[],
  memoryWritesEnabled: boolean,
  enabledToolNames: readonly string[] = [],
): string {
  const operatorGuidance = isOperatorAgent
    ? `
You are the protected operator agent. Your role is to help Rolf administer this local multi-agent system through controlled backend tools.

You may use admin tools when they are available to create agents, rename agents, delete non-protected agents, read or update agent soul.md files, list normal tools, grant or revoke normal tools, inspect and manage memories, and enable or disable memory writes for agents. These are controlled application tools, not raw CLI or shell access. Do not claim to have unrestricted terminal access.`
    : '';
  const memoryWriteGuidance = memoryWritesEnabled
    ? 'Use the save_memory tool when the user explicitly asks you to remember something or when a future-useful, low-risk memory clearly fits the memory rules. Use agent_user for user preferences that apply only to this agent, including how the user wants this agent to communicate. Use user only when the user clearly wants the memory shared across agents. If the user explicitly asks you to remember sensitive personal data, you may save it, but use the narrowest sensible scope and never save secrets or credentials. Ask first when sensitive information was not explicitly requested for memory, or when the content, consent, or scope is ambiguous or conflicting.'
    : 'Memory writing is disabled for this agent in the current run. Do not claim that you saved a new memory. If the user asks you to remember something, explain that memory writing is disabled for this agent and that the setting can be changed by the user.';
  const hasInternetSearch = enabledToolNames.includes('internet_search');
  const hasWebPageReader = enabledToolNames.includes('read_web_page');
  const hasResearch = enabledToolNames.includes('research');
  const researchGuidance = hasResearch
    ? `
Research guidance:
- A researcher subagent is available through Deep Agents' task tool.
- Use the task tool to delegate internet research and external information work to the researcher subagent, especially current, latest, recent, or uncertain facts.
- Give the researcher the full user question and name concrete requirements such as date, teams, final_score, winner, version, price, source, or status.
- When the user uses relative dates such as today, yesterday, current, latest, recent, heute, gestern, aktuell, or neueste, include the current local date/time from the user profile and the resolved absolute date in the task description.
- Use the researcher's structured result as your evidence: answer from findings and sources, mention unresolved items and warnings when status is partial or unresolved, and do not guess missing values.
- For latest, last, current, most recent, and next questions, check the researcher's temporalCandidates before answering. Do not call an item "latest", "last", "current", or "next" when another candidate has a later or more relevant date.
- For claim-checking or rumor questions, preserve the researcher's claimStatus. Say "reported" when reputable sources report something without official confirmation. Do not convert official-source silence into "false" unless the researcher found reliable evidence that directly contradicts the claim.
- If the researcher's answer contradicts its findings, temporalCandidates, warnings, or sources, state that the result is unresolved and ask for/perform more research instead of presenting a confident answer.
- Do not manually start with internet_search or read_web_page when the researcher subagent is available unless the user asks for low-level browsing or debugging.`
    : '';
  const internetSearchGuidance = hasInternetSearch
    ? `
Internet search guidance:
- Use internet_search for current, fast-changing, or uncertain facts.
- Build precise search queries with date, entity, event, and requested answer type.
- Read the returned qualityHints. If qualityHints.likelyNeedsFollowUp is true, prefer a narrower follow-up search before answering.
- After a search, assess whether the results actually answer the user's question.
- If the first results are ambiguous, stale, incomplete, or answer a different question, run a narrower follow-up search before answering.
- If read_web_page is available and snippets are not enough, read one or more promising source pages before answering.
- For precise current-list questions such as "latest N", "last N", "top N", "current N", or "newest N", first identify the exact requested items, then verify each item separately before answering.
- For questions that ask for results, statuses, prices, releases, rankings, dates, or other concrete values for multiple items, do not answer until every requested item has a verified value or you clearly say which item remains unverified.
- If one requested item is missing a confirmed value, run a targeted follow-up search for that exact item before answering.
- If read_web_page is available for a precise current-list or current-result question, do not answer from search snippets alone. Read source pages for the key evidence before finalizing the answer.
- For sports, news, and current events, distinguish previews, schedules, live updates, and final results; when asked for latest games or results, search for latest completed results.
- Prefer recent sources with clear published dates.
- Verify time-sensitive answers with more than one source when practical; use source-page reading for the most important verification when available.
- If the answer is sufficiently verified, answer directly and do not add meta commentary about search quality.
- If search results conflict or are incomplete, say what is uncertain instead of guessing.
- Do not present a result as final when the source only describes a scheduled or upcoming event.`
    : '';
  const webPageReaderGuidance = hasWebPageReader
    ? `
Web page reading guidance:
- Use read_web_page to inspect public source pages when search snippets do not contain enough evidence.
- Prefer reading official sources, reputable news/reporting, event pages, or result pages over generic search result snippets.
- For precise current-list and current-result questions, read the best available source page for each requested item before finalizing the answer.
- If a source page confirms only one item in a requested list, continue searching or reading until the remaining items are confirmed or explicitly mark them as unverified.
- Do not use read_web_page for private, local, or internal URLs.`
    : '';

  return `You are the configured local agent named "${agent.name}".

Your stable identity, role, personality, and operating principles are loaded from ${agent.soulVirtualPath}. Treat that identity file as the source of truth for who this agent is.

Do not use soul.md for arbitrary memories, transient facts, game results, project notes, or conversation history. Those belong in dedicated memory files or threads.
${operatorGuidance}

Loaded soul.md:
${soulContent}

Retrieved long-term memories:
${formatMemories(memories)}

User profile and display preferences:
- Name: ${userProfile.name || 'not configured'}
- Time zone: ${userProfile.timeZone}
- Language: ${userProfile.language}
- Regional format: ${userProfile.locale}
- Date style: ${userProfile.dateStyle}
- Time style: ${userProfile.timeStyle}
- Current local date/time: ${formatLocalDateTime(userProfile)}

When presenting dates and times to the user, prefer the user profile's time zone, language, regional format, date style, and time style unless the user asks for a different format.

Use enabled tools when they are useful. Do not claim to have tools that are not available in the current run.
${researchGuidance}
${internetSearchGuidance}
${webPageReaderGuidance}

${memoryWriteGuidance}

If the file does not contain a specific instruction for a situation, be practical, conversational, and clear about uncertainty.`;
}

function formatMemories(memories: readonly MemoryRecord[]): string {
  if (!memories.length) {
    return '- none found for this prompt';
  }

  return memories
    .map((memory) =>
      [
        `- [${memory.id}] ${memory.type}, ${memory.scope}, ${memory.lifetime}: ${memory.content}`,
        memory.tags.length ? `  tags: ${memory.tags.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
}

function formatLocalDateTime(userProfile: UserProfile): string {
  try {
    return new Intl.DateTimeFormat(userProfile.locale, {
      dateStyle: userProfile.dateStyle,
      timeStyle: userProfile.timeStyle,
      timeZone: userProfile.timeZone,
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

function extractText(result: unknown): string {
  const messages = readProperty<unknown[]>(result, 'messages');
  const lastMessage = messages?.at(-1);
  const content = readProperty<unknown>(lastMessage, 'content');

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => readProperty<unknown>(part, 'text'))
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
      .trim();

    if (text) {
      return text;
    }
  }

  return 'The agent completed the run, but no assistant text was returned.';
}

function extractToolCalls(result: unknown): readonly RunContextToolCall[] {
  const messages = readProperty<unknown[]>(result, 'messages') ?? [];
  const calls = new Map<string, RunContextToolCall>();
  const unnamedCalls: RunContextToolCall[] = [];

  for (const message of messages) {
    for (const call of readToolCalls(message)) {
      const id = readProperty<string>(call, 'id');
      const toolCall: RunContextToolCall = {
        id,
        name: readProperty<string>(call, 'name'),
        args: readProperty<unknown>(call, 'args') ?? readProperty<unknown>(call, 'arguments'),
      };

      if (id) {
        calls.set(id, {
          ...calls.get(id),
          ...toolCall,
        });
      } else {
        unnamedCalls.push(toolCall);
      }
    }

    const toolResult = readToolResult(message);

    if (!toolResult) {
      continue;
    }

    if (toolResult.id) {
      calls.set(toolResult.id, {
        ...calls.get(toolResult.id),
        id: toolResult.id,
        name: calls.get(toolResult.id)?.name ?? toolResult.name,
        result: toolResult.result,
      });
    } else {
      unnamedCalls.push(toolResult);
    }
  }

  return [...calls.values(), ...unnamedCalls];
}

function readToolCalls(message: unknown): readonly unknown[] {
  const directToolCalls = readProperty<unknown[]>(message, 'tool_calls');

  if (Array.isArray(directToolCalls)) {
    return directToolCalls;
  }

  const additionalKwargs = readProperty<unknown>(message, 'additional_kwargs');
  const nestedToolCalls = readProperty<unknown[]>(additionalKwargs, 'tool_calls');

  return Array.isArray(nestedToolCalls) ? nestedToolCalls : [];
}

function readToolResult(message: unknown): RunContextToolCall | null {
  const type = readProperty<string>(message, 'type');
  const role = readProperty<string>(message, 'role');
  const name = readProperty<string>(message, 'name');
  const id =
    readProperty<string>(message, 'tool_call_id') ??
    readProperty<string>(message, 'id') ??
    undefined;

  if (type !== 'tool' && role !== 'tool' && !readProperty<unknown>(message, 'tool_call_id')) {
    return null;
  }

  return {
    id,
    name,
    result: stringifyToolResult(readProperty<unknown>(message, 'content')),
  };
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  return JSON.stringify(content);
}

function extractTokenUsage(result: unknown): RunContextTokenUsage | undefined {
  const messages = readProperty<unknown[]>(result, 'messages') ?? [];
  const usage = messages.map((message) => readUsageFromMessage(message)).find(Boolean);

  return usage;
}

function readUsageFromMessage(message: unknown): RunContextTokenUsage | undefined {
  const usageMetadata = readProperty<unknown>(message, 'usage_metadata');
  const responseMetadata = readProperty<unknown>(message, 'response_metadata');
  const tokenUsage = readProperty<unknown>(responseMetadata, 'tokenUsage');
  const openAiTokenUsage = readProperty<unknown>(responseMetadata, 'token_usage');
  const source = usageMetadata ?? tokenUsage ?? openAiTokenUsage;

  if (!source) {
    return undefined;
  }

  const inputTokens =
    readNumber(source, 'input_tokens') ??
    readNumber(source, 'promptTokens') ??
    readNumber(source, 'prompt_tokens');
  const outputTokens =
    readNumber(source, 'output_tokens') ??
    readNumber(source, 'completionTokens') ??
    readNumber(source, 'completion_tokens');
  const totalTokens =
    readNumber(source, 'total_tokens') ??
    readNumber(source, 'totalTokens') ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function readNumber(value: unknown, key: string): number | undefined {
  const candidate = readProperty<unknown>(value, key);

  return typeof candidate === 'number' ? candidate : undefined;
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}
