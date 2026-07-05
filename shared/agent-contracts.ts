export type ChatRole = 'user' | 'assistant';

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

export interface AgentProfile {
  readonly id: string;
  readonly name: string;
  readonly soulVirtualPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentsResponse {
  readonly agents: readonly AgentProfile[];
  readonly defaultAgentId: string;
}

export interface CreateAgentRequest {
  readonly id?: string;
  readonly name: string;
}

export interface UpdateAgentRequest {
  readonly name: string;
}

export type AgentRunEvent =
  | {
      readonly type: 'run-started';
      readonly runId: string;
      readonly threadId: string;
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
  readonly dataDir: string;
}
