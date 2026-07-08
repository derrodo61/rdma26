export type ChatRole = 'user' | 'assistant';
export type ThemePreference = 'light' | 'dark' | 'system';
export type DateStylePreference = 'short' | 'medium' | 'long' | 'full';
export type TimeStylePreference = 'short' | 'medium';

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: string;
}

export interface ChatThreadSummary {
  readonly id: string;
  readonly agentId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface ChatThread extends ChatThreadSummary {
  readonly messages: readonly ChatMessage[];
}

export interface CreateThreadRequest {
  readonly title?: string;
}

export interface DeleteThreadResponse {
  readonly deleted: true;
  readonly agentId: string;
  readonly threadId: string;
}

export interface AgentRunRequest {
  readonly agentId: string;
  readonly threadId: string;
  readonly prompt: string;
  readonly model: string;
}

export type AgentKind = 'chat' | 'operator' | 'internal';

export interface AgentProfile {
  readonly id: string;
  readonly name: string;
  readonly kind: AgentKind;
  readonly chatEnabled: boolean;
  readonly enabledTools: readonly string[];
  readonly memory: AgentMemorySettings;
  readonly soulVirtualPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMemorySettings {
  readonly canWrite: boolean;
}

export interface AgentsResponse {
  readonly agents: readonly AgentProfile[];
  readonly defaultAgentId: string;
}

export interface CreateAgentRequest {
  readonly id?: string;
  readonly name: string;
  readonly kind?: AgentKind;
  readonly chatEnabled?: boolean;
}

export interface UpdateAgentRequest {
  readonly name?: string;
  readonly kind?: AgentKind;
  readonly chatEnabled?: boolean;
  readonly memory?: Partial<AgentMemorySettings>;
}

export interface AgentSoulResponse {
  readonly agentId: string;
  readonly content: string;
  readonly updatedAt: string;
}

export interface UpdateAgentSoulRequest {
  readonly content: string;
}

export interface ToolDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly provider: string;
  readonly available: boolean;
  readonly unavailableReason?: string;
}

export interface ToolsResponse {
  readonly tools: readonly ToolDefinition[];
}

export interface AgentToolsResponse {
  readonly agentId: string;
  readonly enabledTools: readonly string[];
  readonly tools: readonly ToolDefinition[];
  readonly controlledTools: readonly ToolDefinition[];
}

export interface UpdateAgentToolsRequest {
  readonly enabledTools: readonly string[];
}

export interface DeleteAgentResponse {
  readonly deleted: true;
  readonly agentId: string;
}

export type AgentRunEvent =
  | {
      readonly type: 'run-started';
      readonly runId: string;
      readonly threadId: string;
    }
  | {
      readonly type: 'run-activity';
      readonly label: string;
      readonly detail?: string;
    }
  | {
      readonly type: 'message';
      readonly content: string;
    }
  | {
      readonly type: 'thread-updated';
      readonly thread: ChatThread;
    }
  | {
      readonly type: 'error';
      readonly message: string;
    }
  | {
      readonly type: 'run-finished';
      readonly runId: string;
      readonly threadId: string;
    };

export interface ModelOption {
  readonly id: string;
  readonly label: string;
  readonly provider: 'openai';
  readonly requiresApiKey: true;
}

export interface ModelsResponse {
  readonly models: readonly ModelOption[];
  readonly defaultModel: string;
}

export interface HealthResponse {
  readonly ok: true;
  readonly service: 'rdma26-backend';
  readonly agents: readonly AgentProfile[];
  readonly defaultAgentId: string;
  readonly apiKeyConfigured: boolean;
  readonly authEnabled: boolean;
  readonly dataDir: string;
}

export interface AuthSessionResponse {
  readonly authEnabled: boolean;
  readonly authenticated: boolean;
  readonly username?: string;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
}

export interface AgentSettings {
  readonly model?: string;
}

export interface UserProfile {
  readonly name: string;
  readonly timeZone: string;
  readonly language: string;
  readonly locale: string;
  readonly dateStyle: DateStylePreference;
  readonly timeStyle: TimeStylePreference;
  readonly theme: ThemePreference;
  readonly agentSettings: Readonly<Record<string, AgentSettings>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateUserProfileRequest {
  readonly name?: string;
  readonly timeZone?: string;
  readonly language?: string;
  readonly locale?: string;
  readonly dateStyle?: DateStylePreference;
  readonly timeStyle?: TimeStylePreference;
  readonly theme?: ThemePreference;
  readonly agentSettings?: Readonly<Record<string, AgentSettings>>;
}

export type MemoryScope = 'agent' | 'agent_user' | 'user';
export type MemoryType =
  'fact' | 'preference' | 'conversation_summary' | 'open_task' | 'tracked_topic';
export type MemoryStatus = 'active' | 'archived' | 'superseded';
export type MemoryLifetime = 'permanent' | 'active' | 'temporary';

export interface MemorySource {
  readonly agentId?: string;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly note?: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly type: MemoryType;
  readonly status: MemoryStatus;
  readonly lifetime: MemoryLifetime;
  readonly content: string;
  readonly tags: readonly string[];
  readonly source?: MemorySource;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryListRequest {
  readonly agentId?: string;
  readonly scope?: MemoryScope;
  readonly type?: MemoryType;
  readonly status?: MemoryStatus;
  readonly query?: string;
  readonly limit?: number;
}

export interface MemoryListResponse {
  readonly memories: readonly MemoryRecord[];
}

export interface CreateMemoryRequest {
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly type: MemoryType;
  readonly lifetime?: MemoryLifetime;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly source?: MemorySource;
}

export interface UpdateMemoryRequest {
  readonly type?: MemoryType;
  readonly status?: MemoryStatus;
  readonly lifetime?: MemoryLifetime;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly source?: MemorySource;
}

export interface DeleteMemoryResponse {
  readonly deleted: true;
  readonly memoryId: string;
}

export interface ThreadSummaryRequest {
  readonly model?: string;
}

export interface ThreadSummariesRequest extends ThreadSummaryRequest {
  readonly limit?: number;
}

export interface ThreadSummaryResponse {
  readonly agentId: string;
  readonly threadId: string;
  readonly model?: string;
  readonly memory: MemoryRecord;
}

export interface ThreadSummariesResponse {
  readonly agentId: string;
  readonly summaries: readonly ThreadSummaryResponse[];
  readonly skippedEmptyThreads: readonly string[];
}

export interface MemoryMaintenanceRequest extends ThreadSummaryRequest {
  readonly agentId?: string;
  readonly limitPerAgent?: number;
}

export interface AgentMemoryMaintenanceResult extends ThreadSummariesResponse {
  readonly skippedReason?: 'memory_writes_disabled';
}

export interface MemoryMaintenanceResponse {
  readonly mode: 'manual';
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly agents: readonly AgentMemoryMaintenanceResult[];
}

export interface MemoryMaintenanceSettings {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly agentId?: string;
  readonly model?: string;
  readonly limitPerAgent: number;
  readonly lastStartedAt?: string;
  readonly lastFinishedAt?: string;
  readonly lastError?: string;
  readonly updatedAt: string;
}

export interface UpdateMemoryMaintenanceSettingsRequest {
  readonly enabled?: boolean;
  readonly intervalMinutes?: number;
  readonly agentId?: string;
  readonly model?: string;
  readonly limitPerAgent?: number;
}

export interface MemoryContextSource {
  readonly memoryId: string;
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly type: MemoryType;
  readonly score: number;
}

export interface RunContextMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly createdAt: string;
  readonly content: string;
}

export interface RunContextMemory {
  readonly memoryId: string;
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly type: MemoryType;
  readonly status?: MemoryStatus;
  readonly lifetime?: MemoryLifetime;
  readonly tags?: readonly string[];
  readonly source?: MemorySource;
  readonly score: number;
  readonly content: string;
}

export interface RunContextTool {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly provider?: string;
  readonly controlled: boolean;
}

export interface RunContextToolCall {
  readonly id?: string;
  readonly name?: string;
  readonly args?: unknown;
  readonly result?: string;
}

export interface RunContextTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface RunContextDetails {
  readonly runId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly threadId: string;
  readonly threadTitle?: string;
  readonly model: string;
  readonly createdAt: string;
  readonly prompt?: string;
  readonly assistantResponse?: string;
  readonly soulVirtualPath: string;
  readonly soulContent: string;
  readonly userProfile: UserProfile;
  readonly memories: readonly RunContextMemory[];
  readonly messages: readonly RunContextMessage[];
  readonly tools: readonly RunContextTool[];
  readonly toolCalls?: readonly RunContextToolCall[];
  readonly tokenUsage?: RunContextTokenUsage;
  readonly memoryWritesEnabled: boolean;
}
