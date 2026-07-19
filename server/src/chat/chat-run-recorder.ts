import type {
  AgentRunRequest,
  ChatThread,
  LlmCallRecord,
  RunContextCapability,
  RunContextDetails,
  RunContextTokenUsage,
  RunContextTool,
  RunContextWithheldCapability,
  SkillPackageSummary,
  UserProfile,
} from '../../../shared/agent-contracts';
import type { PersonalAgentResponse } from '../agents/personal-agent';
import type { FileMemoryEntry, FileMemoryStore } from '../memory/file-memory-store';
import type { RunContextStore } from '../runs/run-context-store';
import type { AssistantStorage } from '../storage/assistant-storage';

export class ChatRunRecorder {
  constructor(
    private readonly runContextStore: RunContextStore,
    private readonly fileMemoryStore: FileMemoryStore,
  ) {}

  async recordSuccess(
    context: ChatRunRecordingContext,
    response: PersonalAgentResponse,
    thread: ChatThread,
    llmCalls: readonly LlmCallRecord[],
  ): Promise<RunContextDetails> {
    const assistantMessage = thread.messages.at(-1);
    const responseWithUsage = withTokenUsage(response, llmCalls);

    return await this.runContextStore.writeRunContext({
      ...this.baseRunContext(context),
      status: 'success',
      threadTitle: thread.title,
      assistantResponse: responseWithUsage.content,
      assistantMessageId: assistantMessage?.role === 'assistant' ? assistantMessage.id : undefined,
      toolCalls: responseWithUsage.toolCalls,
      skillsUsed: responseWithUsage.skillsUsed,
      tokenUsage: responseWithUsage.tokenUsage,
      llmCalls,
      systemPromptDiagnostics: responseWithUsage.systemPromptDiagnostics,
    });
  }

  async recordFailure(
    context: ChatRunRecordingContext,
    error: unknown,
    llmCalls: readonly LlmCallRecord[],
    status: 'error' | 'cancelled',
  ): Promise<RunContextDetails> {
    return await this.runContextStore.writeRunContext({
      ...this.baseRunContext(context),
      status,
      errorMessage: getErrorMessage(error),
      tokenUsage: summarizeCurrentRunTokenUsage(llmCalls),
      llmCalls,
    });
  }

  responseWithTokenUsage(
    response: PersonalAgentResponse,
    llmCalls: readonly LlmCallRecord[],
  ): PersonalAgentResponse {
    return withTokenUsage(response, llmCalls);
  }

  private baseRunContext(context: ChatRunRecordingContext): RunContextDetails {
    return {
      runId: context.runId,
      agentId: context.storage.agent.id,
      agentName: context.storage.agent.name,
      threadId: context.request.threadId,
      threadTitle: context.userThread.title,
      model: context.model,
      createdAt: new Date().toISOString(),
      prompt: context.request.prompt,
      soulVirtualPath: context.storage.agent.soulVirtualPath,
      soulContent: context.soulContent,
      userProfile: context.userProfile,
      memories: context.pinnedMemories.map((memory) => ({
        memoryId: memory.id,
        scope: memory.scope,
        agentId: memory.agentId,
        pinned: true,
        tags: memory.tags,
        source: memory.source,
        virtualPath: this.fileMemoryStore.virtualPath(memory),
        access: 'startup' as const,
        content: memory.content,
      })),
      messages: context.userThread.messages.map((message) => ({
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
        content: message.content,
      })),
      capabilities: context.capabilities,
      tools: context.tools,
      withheldCapabilities: context.withheldCapabilities,
      installedSkills: context.installedSkills,
      attachedSkills: context.attachedSkills,
      memoryReadsEnabled: context.memoryReadsEnabled,
      memoryWritesEnabled: context.memoryWritesEnabled,
    };
  }
}

export interface ChatRunRecordingContext {
  readonly runId: string;
  readonly storage: AssistantStorage;
  readonly request: AgentRunRequest;
  readonly userThread: ChatThread;
  readonly model: string;
  readonly soulContent: string;
  readonly userProfile: UserProfile;
  readonly pinnedMemories: readonly FileMemoryEntry[];
  readonly capabilities: readonly RunContextCapability[];
  readonly tools: readonly RunContextTool[];
  readonly withheldCapabilities: readonly RunContextWithheldCapability[];
  readonly installedSkills: readonly SkillPackageSummary[];
  readonly attachedSkills: readonly SkillPackageSummary[];
  readonly memoryReadsEnabled: boolean;
  readonly memoryWritesEnabled: boolean;
}

function withTokenUsage(
  response: PersonalAgentResponse,
  llmCalls: readonly LlmCallRecord[],
): PersonalAgentResponse {
  return {
    ...response,
    tokenUsage: summarizeCurrentRunTokenUsage(llmCalls),
  };
}

function summarizeCurrentRunTokenUsage(
  calls: readonly LlmCallRecord[],
): RunContextTokenUsage | undefined {
  if (!calls.length) return undefined;

  const sum = (select: (call: LlmCallRecord) => number | undefined) =>
    calls.reduce((total, call) => total + (select(call) ?? 0), 0);
  const inputTokens = sum((call) => call.inputTokens);
  const outputTokens = sum((call) => call.outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: sum((call) => call.cachedInputTokens),
    reasoningTokens: sum((call) => call.reasoningTokens),
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Agent run failed.';
}
