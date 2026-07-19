type ChatRole = 'user' | 'assistant';
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
  readonly model?: string;
}

export interface OptimizerRunRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly title?: string;
}

export interface OptimizerRunResponse {
  readonly runId: string;
  readonly thread: ChatThread;
  readonly runContext: RunContextDetails;
  readonly content: string;
}

export type AgentKind = 'chat' | 'operator' | 'internal';

export interface AgentProfile {
  readonly id: string;
  readonly name: string;
  readonly kind: AgentKind;
  readonly chatEnabled: boolean;
  readonly enabledCapabilities: readonly string[];
  readonly attachedSkills: readonly string[];
  readonly memory: AgentMemorySettings;
  readonly models: AgentModelSettings;
  readonly soulVirtualPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMemorySettings {
  readonly canRead: boolean;
  readonly canWrite: boolean;
}

export interface AgentModelSettings {
  readonly chat?: string;
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
  readonly models?: Partial<AgentModelSettings>;
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

export interface CapabilityDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly provider: string;
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly providedTools: readonly ToolDefinition[];
}

export interface CapabilitiesResponse {
  readonly capabilities: readonly CapabilityDefinition[];
}

export interface AgentCapabilitiesResponse {
  readonly agentId: string;
  readonly enabledCapabilities: readonly string[];
  readonly capabilities: readonly CapabilityDefinition[];
  readonly controlledTools: readonly ToolDefinition[];
}

export interface UpdateAgentCapabilitiesRequest {
  readonly enabledCapabilities: readonly string[];
}

export type SkillOwnership = 'bundled' | 'user' | 'external';

export interface SkillPackageSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownership: SkillOwnership;
}

export interface SkillFileSummary {
  readonly path: string;
  readonly sizeBytes: number;
}

export interface SkillPackageDetails extends SkillPackageSummary {
  readonly skillMarkdown: string;
  readonly files: readonly SkillFileSummary[];
}

export interface SkillsResponse {
  readonly skills: readonly SkillPackageSummary[];
}

export interface AgentSkillsResponse {
  readonly agentId: string;
  readonly attachedSkillIds: readonly string[];
  readonly requiredSkillIds: readonly string[];
  readonly skills: readonly SkillPackageSummary[];
}

export interface UpdateAgentSkillsRequest {
  readonly attachedSkillIds: readonly string[];
}

export type SkillInstallationSourceType = 'local-directory' | 'local-archive' | 'git' | 'clawhub';

export interface SkillInstallationSource {
  readonly type: SkillInstallationSourceType;
  readonly url?: string;
  readonly path?: string;
  readonly packagePath?: string;
  readonly requestedRevision?: string;
  readonly catalogId?: string;
  readonly catalogSkillId?: string;
}

export type SkillCompatibilityStatus =
  | 'compatible'
  | 'instructions_only'
  | 'missing_capabilities'
  | 'unsupported_runtime'
  | 'unsafe_or_invalid';

export type SkillFindingSeverity = 'info' | 'warning' | 'error';

export interface SkillCompatibilityFinding {
  readonly code: string;
  readonly severity: SkillFindingSeverity;
  readonly message: string;
  readonly path?: string;
}

export interface SkillCompatibilityReport {
  readonly status: SkillCompatibilityStatus;
  readonly requiredCapabilities: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly unsupportedRequirements: readonly string[];
  readonly findings: readonly SkillCompatibilityFinding[];
}

export interface SkillInstalledVersion {
  readonly contentHash: string;
  readonly resolvedRevision?: string;
  readonly version?: string;
  readonly author?: string;
  readonly license?: string;
  readonly installedAt: string;
  readonly compatibility: SkillCompatibilityReport;
}

export interface SkillInstallationRecord {
  readonly skillId: string;
  readonly source: SkillInstallationSource;
  readonly activeContentHash: string;
  readonly pinned: boolean;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly versions: readonly SkillInstalledVersion[];
}

export interface SkillInstallationsResponse {
  readonly installations: readonly SkillInstallationRecord[];
}

export type InstallSkillRequest =
  | {
      readonly sourceType: 'local-directory';
      readonly path: string;
      readonly enabledCapabilities?: readonly string[];
    }
  | {
      readonly sourceType: 'local-archive';
      readonly path: string;
      readonly enabledCapabilities?: readonly string[];
    }
  | {
      readonly sourceType: 'git';
      readonly repositoryUrl: string;
      readonly packagePath?: string;
      readonly revision?: string;
      readonly enabledCapabilities?: readonly string[];
    }
  | {
      readonly sourceType: 'clawhub';
      readonly slug: string;
      readonly version?: string;
      readonly enabledCapabilities?: readonly string[];
    };

export interface InspectSkillUpdateRequest {
  readonly enabledCapabilities?: readonly string[];
}

export interface ApplySkillUpdateRequest extends InspectSkillUpdateRequest {
  readonly expectedContentHash: string;
}

export interface SetSkillPinnedRequest {
  readonly pinned: boolean;
}

export interface RollbackSkillRequest {
  readonly contentHash?: string;
}

export interface SkillFileChange {
  readonly path: string;
  readonly kind: 'added' | 'modified' | 'removed';
}

export interface SkillUpdatePreview {
  readonly skillId: string;
  readonly currentContentHash: string;
  readonly candidate: SkillInstalledVersion;
  readonly changes: readonly SkillFileChange[];
  readonly updateAvailable: boolean;
}

export interface CatalogSkillSummary {
  readonly catalogId: string;
  readonly skillId: string;
  readonly displayName: string;
  readonly description: string;
  readonly version?: string;
  readonly author?: string;
  readonly canonicalUrl: string;
}

export interface CatalogSearchResponse {
  readonly results: readonly CatalogSkillSummary[];
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
  readonly model: string;
  readonly label: string;
  readonly provider: ModelProviderId;
  readonly authMethod: 'api_key' | 'oauth';
  readonly experimental?: boolean;
}

export type ModelProviderId = 'openai-api' | 'openai-chatgpt';

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
  readonly chatGptAuthenticated: boolean;
  readonly authEnabled: boolean;
  readonly dataDir: string;
}

export interface ModelProviderStatus {
  readonly id: ModelProviderId;
  readonly label: string;
  readonly authMethod: 'api_key' | 'oauth';
  readonly authenticated: boolean;
  readonly experimental?: boolean;
  readonly loginPending?: boolean;
  readonly account?: string;
  readonly expiresAt?: string;
  readonly error?: string;
}

export interface ModelProvidersResponse {
  readonly providers: readonly ModelProviderStatus[];
}

export interface ModelProviderLoginStartResponse {
  readonly provider: 'openai-chatgpt';
  readonly authorizationUrl: string;
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
  readonly lastAgentId?: string;
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
  readonly lastAgentId?: string;
  readonly agentSettings?: Readonly<Record<string, AgentSettings>>;
}

export type MemoryScope = 'agent' | 'agent_user' | 'user';

interface MemorySource {
  readonly agentId?: string;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly note?: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly pinned: boolean;
  readonly content: string;
  readonly contentLines?: readonly string[];
  readonly tags: readonly string[];
  readonly source?: MemorySource;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryListRequest {
  readonly agentId?: string;
  readonly scope?: MemoryScope;
  readonly pinned?: boolean;
  readonly tag?: string;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly updatedFrom?: string;
  readonly updatedTo?: string;
  readonly query?: string;
  readonly limit?: number;
}

export interface MemoryListResponse {
  readonly memories: readonly MemoryRecord[];
}

export interface MemoryPinnedBudget {
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly usedCharacters: number;
  readonly limitCharacters: number;
}

export interface MemoryPinnedBudgetsResponse {
  readonly agentId: string;
  readonly budgets: readonly MemoryPinnedBudget[];
}

export interface CreateMemoryRequest {
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly pinned?: boolean;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly source?: MemorySource;
}

export interface UpdateMemoryRequest {
  readonly pinned?: boolean;
  readonly content?: string;
  readonly tags?: readonly string[];
  readonly source?: MemorySource;
}

export interface DeleteMemoryResponse {
  readonly deleted: true;
  readonly memoryId: string;
}

interface RunContextMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly createdAt: string;
  readonly content: string;
}

export interface RunContextMemory {
  readonly memoryId: string;
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly pinned: boolean;
  readonly tags?: readonly string[];
  readonly source?: MemorySource;
  readonly virtualPath: string;
  readonly access: 'startup';
  readonly content: string;
}

export interface RunContextTool {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly provider?: string;
  readonly controlled: boolean;
}

export interface RunContextWithheldCapability {
  readonly id: string;
  readonly reason: string;
}

export interface RunContextToolCall {
  readonly id?: string;
  readonly name?: string;
  readonly agentName?: string;
  readonly args?: unknown;
  readonly result?: string;
}

export interface RunContextSkillUsage {
  readonly name: string;
  readonly path: string;
}

export interface RunContextTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
}

export type LlmCallStatus = 'success' | 'error' | 'cancelled';
export type ModelPricingStatus = 'active' | 'inactive';
export type PricingSourceTrustLevel = 'official' | 'third_party' | 'user_added';

export type LlmCallPurpose =
  'chat' | 'thread_summary' | 'memory_retrieval' | 'memory_maintenance' | 'operator' | 'unknown';

export interface LlmCallRecord {
  readonly id: string;
  readonly runId?: string;
  readonly provider: string;
  readonly model: string;
  readonly purpose: LlmCallPurpose;
  readonly status: LlmCallStatus;
  readonly agentId?: string;
  readonly threadId?: string;
  readonly parentProviderRunId?: string;
  readonly providerRunId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly requestStartedAt: string;
  readonly requestFinishedAt?: string;
  readonly durationMs?: number;
  readonly errorMessage?: string;
  readonly pricingSnapshotId?: string;
  readonly estimatedInputCost?: number;
  readonly estimatedOutputCost?: number;
  readonly estimatedCachedInputCost?: number;
  readonly estimatedReasoningCost?: number;
  readonly estimatedTotalCost?: number;
  readonly estimatedCostCurrency?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LlmCallListRequest {
  readonly agentId?: string;
  readonly threadId?: string;
  readonly runId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly purpose?: LlmCallPurpose;
  readonly status?: LlmCallStatus;
  readonly startedFrom?: string;
  readonly startedTo?: string;
  readonly limit?: number;
}

export interface LlmCallListResponse {
  readonly calls: readonly LlmCallRecord[];
}

export type CostSummaryGroupBy = 'day' | 'agent' | 'model' | 'purpose';

export interface CostSummaryRequest {
  readonly agentId?: string;
  readonly threadId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly purpose?: LlmCallPurpose;
  readonly status?: LlmCallStatus;
  readonly startedFrom?: string;
  readonly startedTo?: string;
  readonly groupBy?: CostSummaryGroupBy;
}

export interface CostSummaryRow {
  readonly key: string;
  readonly currency?: string;
  readonly callCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedTotalCost?: number;
}

export interface CostSummaryResponse {
  readonly groupBy: CostSummaryGroupBy;
  readonly rows: readonly CostSummaryRow[];
}

export interface ModelPricingRecord {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly inputCostPerMillionTokens: number;
  readonly outputCostPerMillionTokens: number;
  readonly cachedInputCostPerMillionTokens?: number;
  readonly reasoningCostPerMillionTokens?: number;
  readonly currency: string;
  readonly sourceUrl: string;
  readonly sourceName?: string;
  readonly sourceRetrievedAt: string;
  readonly status: ModelPricingStatus;
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModelPricingListRequest {
  readonly provider?: string;
  readonly model?: string;
  readonly status?: ModelPricingStatus;
}

export interface ModelPricingListResponse {
  readonly pricing: readonly ModelPricingRecord[];
}

export interface CreateModelPricingRequest {
  readonly provider: string;
  readonly model: string;
  readonly inputCostPerMillionTokens: number;
  readonly outputCostPerMillionTokens: number;
  readonly cachedInputCostPerMillionTokens?: number;
  readonly reasoningCostPerMillionTokens?: number;
  readonly currency?: string;
  readonly sourceUrl: string;
  readonly sourceName?: string;
  readonly sourceRetrievedAt?: string;
  readonly notes?: string;
}

export interface UpdateModelPricingRequest {
  readonly provider?: string;
  readonly model?: string;
  readonly inputCostPerMillionTokens?: number;
  readonly outputCostPerMillionTokens?: number;
  readonly cachedInputCostPerMillionTokens?: number | null;
  readonly reasoningCostPerMillionTokens?: number | null;
  readonly currency?: string;
  readonly sourceUrl?: string;
  readonly sourceName?: string | null;
  readonly sourceRetrievedAt?: string;
  readonly notes?: string | null;
}

export interface SetModelPricingActiveRequest {
  readonly active: boolean;
}

export interface DeleteModelPricingResponse {
  readonly deleted: true;
  readonly pricingId: string;
}

export interface PricingSourceRecord {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly url: string;
  readonly trustLevel: PricingSourceTrustLevel;
  readonly active: boolean;
  readonly notes?: string;
  readonly lastCheckedAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PricingSourceListRequest {
  readonly provider?: string;
  readonly trustLevel?: PricingSourceTrustLevel;
  readonly active?: boolean;
}

export interface PricingSourceListResponse {
  readonly sources: readonly PricingSourceRecord[];
}

export interface CreatePricingSourceRequest {
  readonly provider: string;
  readonly name: string;
  readonly url: string;
  readonly trustLevel?: PricingSourceTrustLevel;
  readonly active?: boolean;
  readonly notes?: string;
}

export interface UpdatePricingSourceRequest {
  readonly provider?: string;
  readonly name?: string;
  readonly url?: string;
  readonly trustLevel?: PricingSourceTrustLevel;
  readonly active?: boolean;
  readonly notes?: string;
}

export interface DeletePricingSourceResponse {
  readonly deleted: true;
  readonly sourceId: string;
}

export type OpenAiPricingComparisonStatus = 'match' | 'different' | 'missing_official';

export interface SyncOpenAiModelPricingResult {
  readonly summary: string;
  readonly source: {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly retrievedAt: string;
  };
  readonly officialModelCount: number;
  readonly savedActiveModelCount: number;
  readonly matchedModels: readonly string[];
  readonly updatedModels: readonly string[];
  readonly different: readonly OpenAiPricingComparison[];
  readonly missingOfficialModels: readonly string[];
  readonly missingLocalModels: readonly string[];
  readonly missingLocalPricing: readonly OpenAiOfficialPricingRecord[];
  readonly metadataWarnings: readonly OpenAiPricingMetadataWarning[];
  readonly notes: readonly string[];
}

export interface OpenAiPricingMetadataWarning {
  readonly model: string;
  readonly warnings: readonly string[];
}

export interface OpenAiPricingComparison {
  readonly model: string;
  readonly status: OpenAiPricingComparisonStatus;
  readonly saved: OpenAiSavedPricingSnapshot;
  readonly official?: OpenAiOfficialPricingRecord;
  readonly differences: readonly string[];
  readonly metadataWarnings: readonly string[];
}

export interface OpenAiSavedPricingSnapshot {
  readonly pricingId: string;
  readonly inputCostPerMillionTokens: number;
  readonly cachedInputCostPerMillionTokens?: number;
  readonly outputCostPerMillionTokens: number;
  readonly sourceUrl: string;
  readonly sourceName?: string;
}

export interface OpenAiOfficialPricingRecord {
  readonly model: string;
  readonly sourceLabel: string;
  readonly sourceUrl?: string;
  readonly shortContext: OpenAiPricingTier;
  readonly longContext?: OpenAiPricingTier;
}

export interface OpenAiPricingTier {
  readonly inputCostPerMillionTokens?: number;
  readonly cachedInputCostPerMillionTokens?: number;
  readonly cacheWriteCostPerMillionTokens?: number;
  readonly outputCostPerMillionTokens?: number;
}

export interface RunContextDetails {
  readonly runId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly threadId: string;
  readonly threadTitle?: string;
  readonly model: string;
  readonly status?: 'success' | 'error' | 'cancelled';
  readonly createdAt: string;
  readonly prompt?: string;
  readonly assistantResponse?: string;
  readonly errorMessage?: string;
  readonly assistantMessageId?: string;
  readonly soulVirtualPath: string;
  readonly soulContent: string;
  readonly userProfile: UserProfile;
  readonly memories: readonly RunContextMemory[];
  readonly messages: readonly RunContextMessage[];
  readonly capabilities?: readonly RunContextCapability[];
  readonly tools: readonly RunContextTool[];
  readonly withheldCapabilities?: readonly RunContextWithheldCapability[];
  readonly toolCalls?: readonly RunContextToolCall[];
  readonly skillsUsed?: readonly RunContextSkillUsage[];
  readonly tokenUsage?: RunContextTokenUsage;
  readonly llmCalls?: readonly LlmCallRecord[];
  readonly memoryReadsEnabled: boolean;
  readonly memoryWritesEnabled: boolean;
  readonly systemPromptDiagnostics?: RunContextSystemPromptDiagnostics;
}

export interface RunContextCapability {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly provider: string;
}

export interface RunContextSystemPromptDiagnostics {
  readonly characterCount: number;
  readonly contentHash: string;
  readonly includedSections: readonly string[];
  readonly continuityGuidance?: string;
}
