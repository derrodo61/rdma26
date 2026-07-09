import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
  AgentRunEvent,
  AgentRunRequest,
  AgentSoulResponse,
  AgentToolsResponse,
  AgentProfile,
  AgentsResponse,
  AuthSessionResponse,
  ChatThread,
  ChatThreadSummary,
  CostSummaryRequest,
  CostSummaryResponse,
  CreateAgentRequest,
  CreateMemoryRequest,
  CreateModelPricingRequest,
  DeleteAgentResponse,
  DeleteMemoryResponse,
  DeleteThreadResponse,
  HealthResponse,
  LlmCallListRequest,
  LlmCallListResponse,
  MemoryMaintenanceRequest,
  MemoryMaintenanceResponse,
  MemoryMaintenanceSettings,
  MemoryListRequest,
  MemoryListResponse,
  MemoryRecord,
  ModelsResponse,
  ModelPricingListRequest,
  ModelPricingListResponse,
  ModelPricingRecord,
  OptimizerRunRequest,
  OptimizerRunResponse,
  RunContextDetails,
  ThreadSummaryRequest,
  ThreadSummaryResponse,
  ThreadSummariesRequest,
  ThreadSummariesResponse,
  ToolsResponse,
  UpdateMemoryMaintenanceSettingsRequest,
  UpdateAgentRequest,
  UpdateMemoryRequest,
  UpdateAgentSoulRequest,
  UpdateAgentToolsRequest,
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

  async tools(): Promise<ToolsResponse> {
    return await firstValueFrom(this.http.get<ToolsResponse>('/api/tools'));
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

  async updateModelPricing(
    pricingId: string,
    request: UpdateModelPricingRequest,
  ): Promise<ModelPricingRecord> {
    return await firstValueFrom(
      this.http.patch<ModelPricingRecord>(`/api/model-pricing/${pricingId}`, request),
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

  async runMemoryMaintenance(
    request: MemoryMaintenanceRequest = {},
  ): Promise<MemoryMaintenanceResponse> {
    return await firstValueFrom(
      this.http.post<MemoryMaintenanceResponse>('/api/memories/maintenance', request),
    );
  }

  async memoryMaintenanceSettings(): Promise<MemoryMaintenanceSettings> {
    return await firstValueFrom(
      this.http.get<MemoryMaintenanceSettings>('/api/memories/maintenance/settings'),
    );
  }

  async updateMemoryMaintenanceSettings(
    request: UpdateMemoryMaintenanceSettingsRequest,
  ): Promise<MemoryMaintenanceSettings> {
    return await firstValueFrom(
      this.http.patch<MemoryMaintenanceSettings>('/api/memories/maintenance/settings', request),
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

  async agentTools(agentId: string): Promise<AgentToolsResponse> {
    return await firstValueFrom(this.http.get<AgentToolsResponse>(`/api/agents/${agentId}/tools`));
  }

  async updateAgentTools(
    agentId: string,
    request: UpdateAgentToolsRequest,
  ): Promise<AgentToolsResponse> {
    return await firstValueFrom(
      this.http.put<AgentToolsResponse>(`/api/agents/${agentId}/tools`, request),
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

  async consolidateThreadSummary(
    agentId: string,
    threadId: string,
    request: ThreadSummaryRequest = {},
  ): Promise<ThreadSummaryResponse> {
    return await firstValueFrom(
      this.http.post<ThreadSummaryResponse>(
        `/api/agents/${agentId}/threads/${threadId}/summary`,
        request,
      ),
    );
  }

  async consolidateAgentThreadSummaries(
    agentId: string,
    request: ThreadSummariesRequest = {},
  ): Promise<ThreadSummariesResponse> {
    return await firstValueFrom(
      this.http.post<ThreadSummariesResponse>(`/api/agents/${agentId}/threads/summaries`, request),
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
