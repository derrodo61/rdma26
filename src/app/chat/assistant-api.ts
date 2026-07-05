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
  CreateAgentRequest,
  DeleteAgentResponse,
  DeleteThreadResponse,
  HealthResponse,
  ModelsResponse,
  ToolsResponse,
  UpdateAgentRequest,
  UpdateAgentSoulRequest,
  UpdateAgentToolsRequest,
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

  async runAgent(request: AgentRunRequest, onEvent: (event: AgentRunEvent) => void): Promise<void> {
    const response = await fetch('/api/agent-runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
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

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const event = parseServerSentEvent(part);

        if (event) {
          onEvent(event);
        }
      }
    }
  }
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
