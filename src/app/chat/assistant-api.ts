import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
  AgentRunEvent,
  AgentRunRequest,
  AgentSkillsResponse,
  AgentSoulResponse,
  AgentCapabilitiesResponse,
  AgentProfile,
  AgentsResponse,
  AuthSessionResponse,
  ApplySkillUpdateRequest,
  CatalogSearchResponse,
  ChatThread,
  ChatThreadSummary,
  CostSummaryRequest,
  CostSummaryResponse,
  CreateAgentRequest,
  CreateMemoryRequest,
  CreateModelPricingRequest,
  DeleteAgentResponse,
  DeleteMemoryResponse,
  DeleteModelPricingResponse,
  DeleteThreadResponse,
  HealthResponse,
  InstallSkillRequest,
  LlmCallListRequest,
  LlmCallListResponse,
  MemoryListRequest,
  MemoryListResponse,
  MemoryPinnedBudgetsResponse,
  MemoryRecord,
  ModelsResponse,
  ModelProviderLoginStartResponse,
  ModelProvidersResponse,
  ModelProviderStatus,
  ModelPricingListRequest,
  ModelPricingListResponse,
  ModelPricingRecord,
  OptimizerRunRequest,
  OptimizerRunResponse,
  PricingSourceListResponse,
  RunContextDetails,
  RollbackSkillRequest,
  SetSkillPinnedRequest,
  SkillInstallationRecord,
  SkillInstallationsResponse,
  SkillPackageDetails,
  SkillsResponse,
  SkillUpdatePreview,
  CapabilitiesResponse,
  SyncOpenAiModelPricingResult,
  UpdateAgentRequest,
  UpdateMemoryRequest,
  UpdateAgentSoulRequest,
  UpdateAgentSkillsRequest,
  UpdateAgentCapabilitiesRequest,
  UpdateModelPricingRequest,
  UpdateUserProfileRequest,
  UserProfile,
} from '../../../shared/agent-contracts';

@Injectable({ providedIn: 'root' })
export class AssistantApi {
  private readonly http = inject(HttpClient);

  async health(): Promise<HealthResponse> {
    return await firstValueFrom(this.http.get<HealthResponse>('/api/health'));
  }

  async session(): Promise<AuthSessionResponse> {
    return await firstValueFrom(this.http.get<AuthSessionResponse>('/api/auth/session'));
  }

  async login(username: string, password: string): Promise<AuthSessionResponse> {
    return await firstValueFrom(
      this.http.post<AuthSessionResponse>('/api/auth/login', { username, password }),
    );
  }

  async logout(): Promise<AuthSessionResponse> {
    return await firstValueFrom(this.http.post<AuthSessionResponse>('/api/auth/logout', {}));
  }

  async models(): Promise<ModelsResponse> {
    return await firstValueFrom(this.http.get<ModelsResponse>('/api/models'));
  }

  async modelProviders(): Promise<ModelProvidersResponse> {
    return await firstValueFrom(this.http.get<ModelProvidersResponse>('/api/model-providers'));
  }

  async startOpenAiChatGptLogin(): Promise<ModelProviderLoginStartResponse> {
    return await firstValueFrom(
      this.http.post<ModelProviderLoginStartResponse>(
        '/api/model-providers/openai-chatgpt/login',
        {},
      ),
    );
  }

  async logoutOpenAiChatGpt(): Promise<ModelProviderStatus> {
    return await firstValueFrom(
      this.http.delete<ModelProviderStatus>('/api/model-providers/openai-chatgpt/session'),
    );
  }

  async capabilities(): Promise<CapabilitiesResponse> {
    return await firstValueFrom(this.http.get<CapabilitiesResponse>('/api/capabilities'));
  }

  async skills(): Promise<SkillsResponse> {
    return await firstValueFrom(this.http.get<SkillsResponse>('/api/skills'));
  }

  async readSkill(skillId: string): Promise<SkillPackageDetails> {
    return await firstValueFrom(this.http.get<SkillPackageDetails>(`/api/skills/${skillId}`));
  }

  async skillInstallations(): Promise<SkillInstallationsResponse> {
    return await firstValueFrom(
      this.http.get<SkillInstallationsResponse>('/api/skill-installations'),
    );
  }

  async installSkill(request: InstallSkillRequest): Promise<SkillInstallationRecord> {
    return await firstValueFrom(
      this.http.post<SkillInstallationRecord>('/api/skill-installations', request),
    );
  }

  async inspectSkillUpdate(skillId: string): Promise<SkillUpdatePreview> {
    return await firstValueFrom(
      this.http.post<SkillUpdatePreview>(
        `/api/skill-installations/${skillId}/update-inspection`,
        {},
      ),
    );
  }

  async applySkillUpdate(
    skillId: string,
    request: ApplySkillUpdateRequest,
  ): Promise<SkillInstallationRecord> {
    return await firstValueFrom(
      this.http.post<SkillInstallationRecord>(
        `/api/skill-installations/${skillId}/update`,
        request,
      ),
    );
  }

  async setSkillPinned(
    skillId: string,
    request: SetSkillPinnedRequest,
  ): Promise<SkillInstallationRecord> {
    return await firstValueFrom(
      this.http.patch<SkillInstallationRecord>(`/api/skill-installations/${skillId}/pin`, request),
    );
  }

  async rollbackSkill(
    skillId: string,
    request: RollbackSkillRequest = {},
  ): Promise<SkillInstallationRecord> {
    return await firstValueFrom(
      this.http.post<SkillInstallationRecord>(
        `/api/skill-installations/${skillId}/rollback`,
        request,
      ),
    );
  }

  async searchSkillCatalog(
    query: string,
    catalogId = 'clawhub',
    limit = 20,
  ): Promise<CatalogSearchResponse> {
    return await firstValueFrom(
      this.http.get<CatalogSearchResponse>(`/api/skill-catalogs/${catalogId}/search`, {
        params: { query, limit },
      }),
    );
  }

  async agentSkills(agentId: string): Promise<AgentSkillsResponse> {
    return await firstValueFrom(
      this.http.get<AgentSkillsResponse>(`/api/agents/${agentId}/skills`),
    );
  }

  async updateAgentSkills(
    agentId: string,
    request: UpdateAgentSkillsRequest,
  ): Promise<AgentSkillsResponse> {
    return await firstValueFrom(
      this.http.put<AgentSkillsResponse>(`/api/agents/${agentId}/skills`, request),
    );
  }

  async llmCalls(request: LlmCallListRequest = {}): Promise<LlmCallListResponse> {
    return await firstValueFrom(
      this.http.get<LlmCallListResponse>('/api/llm-calls', {
        params: toHttpParams(request),
      }),
    );
  }

  async costSummary(request: CostSummaryRequest = {}): Promise<CostSummaryResponse> {
    return await firstValueFrom(
      this.http.get<CostSummaryResponse>('/api/costs/summary', {
        params: toHttpParams(request),
      }),
    );
  }

  async modelPricing(request: ModelPricingListRequest = {}): Promise<ModelPricingListResponse> {
    return await firstValueFrom(
      this.http.get<ModelPricingListResponse>('/api/model-pricing', {
        params: toHttpParams(request),
      }),
    );
  }

  async createModelPricing(request: CreateModelPricingRequest): Promise<ModelPricingRecord> {
    return await firstValueFrom(this.http.post<ModelPricingRecord>('/api/model-pricing', request));
  }

  async pricingSources(provider?: string): Promise<PricingSourceListResponse> {
    return await firstValueFrom(
      this.http.get<PricingSourceListResponse>('/api/pricing-sources', {
        params: toHttpParams({ provider }),
      }),
    );
  }

  async updateModelPricing(
    pricingId: string,
    request: UpdateModelPricingRequest,
  ): Promise<ModelPricingRecord> {
    return await firstValueFrom(
      this.http.patch<ModelPricingRecord>(`/api/model-pricing/${pricingId}`, request),
    );
  }

  async setModelPricingActive(pricingId: string, active: boolean): Promise<ModelPricingRecord> {
    return await firstValueFrom(
      this.http.patch<ModelPricingRecord>(`/api/model-pricing/${pricingId}/active`, { active }),
    );
  }

  async deleteModelPricing(pricingId: string): Promise<DeleteModelPricingResponse> {
    return await firstValueFrom(
      this.http.delete<DeleteModelPricingResponse>(`/api/model-pricing/${pricingId}`),
    );
  }

  async syncOpenAiModelPricing(
    sourceId?: string,
    apply = false,
  ): Promise<SyncOpenAiModelPricingResult> {
    return await firstValueFrom(
      this.http.post<SyncOpenAiModelPricingResult>('/api/model-pricing/openai/sync', {
        ...(sourceId ? { sourceId } : {}),
        apply,
      }),
    );
  }

  async runOptimizer(request: OptimizerRunRequest): Promise<OptimizerRunResponse> {
    return await firstValueFrom(
      this.http.post<OptimizerRunResponse>('/api/optimizer-runs', request),
    );
  }

  async memories(request: MemoryListRequest = {}): Promise<MemoryListResponse> {
    return await firstValueFrom(
      this.http.get<MemoryListResponse>('/api/memories', { params: toHttpParams(request) }),
    );
  }

  async memoryPinnedBudgets(agentId: string): Promise<MemoryPinnedBudgetsResponse> {
    return await firstValueFrom(
      this.http.get<MemoryPinnedBudgetsResponse>('/api/memories/pinned-budgets', {
        params: { agentId },
      }),
    );
  }

  async createMemory(request: CreateMemoryRequest): Promise<MemoryRecord> {
    return await firstValueFrom(this.http.post<MemoryRecord>('/api/memories', request));
  }

  async updateMemory(memoryId: string, request: UpdateMemoryRequest): Promise<MemoryRecord> {
    return await firstValueFrom(
      this.http.patch<MemoryRecord>(`/api/memories/${memoryId}`, request),
    );
  }

  async deleteMemory(memoryId: string): Promise<DeleteMemoryResponse> {
    return await firstValueFrom(
      this.http.delete<DeleteMemoryResponse>(`/api/memories/${memoryId}`),
    );
  }

  async profile(): Promise<UserProfile> {
    return await firstValueFrom(this.http.get<UserProfile>('/api/profile'));
  }

  async updateProfile(request: UpdateUserProfileRequest): Promise<UserProfile> {
    return await firstValueFrom(this.http.patch<UserProfile>('/api/profile', request));
  }

  async agents(): Promise<AgentsResponse> {
    return await firstValueFrom(this.http.get<AgentsResponse>('/api/agents'));
  }

  async readAgent(agentId: string): Promise<AgentProfile> {
    return await firstValueFrom(this.http.get<AgentProfile>(`/api/agents/${agentId}`));
  }

  async createAgent(request: CreateAgentRequest): Promise<AgentProfile> {
    return await firstValueFrom(this.http.post<AgentProfile>('/api/agents', request));
  }

  async updateAgent(agentId: string, request: UpdateAgentRequest): Promise<AgentProfile> {
    return await firstValueFrom(this.http.patch<AgentProfile>(`/api/agents/${agentId}`, request));
  }

  async runContext(runId: string): Promise<RunContextDetails> {
    return await firstValueFrom(this.http.get<RunContextDetails>(`/api/runs/${runId}/context`));
  }

  async threadRunContexts(
    agentId: string,
    threadId: string,
  ): Promise<readonly RunContextDetails[]> {
    return await firstValueFrom(
      this.http.get<readonly RunContextDetails[]>(
        `/api/agents/${agentId}/threads/${threadId}/run-contexts`,
      ),
    );
  }

  async readAgentSoul(agentId: string): Promise<AgentSoulResponse> {
    return await firstValueFrom(this.http.get<AgentSoulResponse>(`/api/agents/${agentId}/soul`));
  }

  async updateAgentSoul(
    agentId: string,
    request: UpdateAgentSoulRequest,
  ): Promise<AgentSoulResponse> {
    return await firstValueFrom(
      this.http.put<AgentSoulResponse>(`/api/agents/${agentId}/soul`, request),
    );
  }

  async deleteAgent(agentId: string): Promise<DeleteAgentResponse> {
    return await firstValueFrom(this.http.delete<DeleteAgentResponse>(`/api/agents/${agentId}`));
  }

  async agentCapabilities(agentId: string): Promise<AgentCapabilitiesResponse> {
    return await firstValueFrom(
      this.http.get<AgentCapabilitiesResponse>(`/api/agents/${agentId}/capabilities`),
    );
  }

  async updateAgentCapabilities(
    agentId: string,
    request: UpdateAgentCapabilitiesRequest,
  ): Promise<AgentCapabilitiesResponse> {
    return await firstValueFrom(
      this.http.put<AgentCapabilitiesResponse>(`/api/agents/${agentId}/capabilities`, request),
    );
  }

  async listThreads(agentId: string): Promise<readonly ChatThreadSummary[]> {
    return await firstValueFrom(
      this.http.get<readonly ChatThreadSummary[]>(`/api/agents/${agentId}/threads`),
    );
  }

  async createThread(agentId: string, title?: string): Promise<ChatThread> {
    return await firstValueFrom(
      this.http.post<ChatThread>(`/api/agents/${agentId}/threads`, { title }),
    );
  }

  async readThread(agentId: string, threadId: string): Promise<ChatThread> {
    return await firstValueFrom(
      this.http.get<ChatThread>(`/api/agents/${agentId}/threads/${threadId}`),
    );
  }

  async deleteThread(agentId: string, threadId: string): Promise<DeleteThreadResponse> {
    return await firstValueFrom(
      this.http.delete<DeleteThreadResponse>(`/api/agents/${agentId}/threads/${threadId}`),
    );
  }

  async runAgent(request: AgentRunRequest, onEvent: (event: AgentRunEvent) => void): Promise<void> {
    const controller = new AbortController();
    const idleTimeoutMs = 180_000;
    let timedOut = false;
    let finished = false;
    let timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleTimeoutMs);
    const resetTimeout = () => {
      globalThis.clearTimeout(timeoutId);
      timeoutId = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, idleTimeoutMs);
    };

    try {
      const response = await fetch('/api/agent-runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Agent request failed with HTTP ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        resetTimeout();
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const event = parseServerSentEvent(part);

          if (event) {
            if (event.type === 'run-finished' || event.type === 'error') {
              finished = true;
            }

            onEvent(event);
          }
        }
      }

      if (!finished) {
        throw new Error('Agent stream ended before the run finished.');
      }
    } catch (error) {
      if (timedOut) {
        throw new Error('Agent request timed out while waiting for activity.', { cause: error });
      }

      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function toHttpParams<TRequest extends object>(request: TRequest): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

function parseServerSentEvent(part: string): AgentRunEvent | null {
  const dataLine = part
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data:'));

  if (!dataLine) {
    return null;
  }

  return JSON.parse(dataLine.slice(5).trim()) as AgentRunEvent;
}
