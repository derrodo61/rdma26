import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { vi, type MockedFunction } from 'vitest';

import type {
  AgentProfile,
  AgentsResponse,
  AuthSessionResponse,
  HealthResponse,
  ModelOption,
  ModelsResponse,
  UserProfile,
} from '../../../../shared/agent-contracts';
import { AgentSettingsStorage } from '../../settings/agent-settings-storage';
import { UserProfileSyncService } from '../../settings/user-profile-sync';
import { AssistantApi } from '../assistant-api';
import { ChatThreadState } from './chat-thread-state';
import { ChatWorkspaceController } from './chat-workspace-controller';

type WorkspaceApi = Pick<
  AssistantApi,
  'agents' | 'health' | 'login' | 'logout' | 'models' | 'session' | 'updateAgent'
>;

type WorkspaceApiMock = {
  readonly [Method in keyof WorkspaceApi]: MockedFunction<WorkspaceApi[Method]>;
};

interface UserProfileSyncMock {
  readonly loadAndHydrate: MockedFunction<UserProfileSyncService['loadAndHydrate']>;
  readonly updateAgentModel: MockedFunction<UserProfileSyncService['updateAgentModel']>;
  readonly updateLastAgent: MockedFunction<UserProfileSyncService['updateLastAgent']>;
  readonly updateTheme: MockedFunction<UserProfileSyncService['updateTheme']>;
}

interface AgentSettingsStorageMock {
  readonly read: MockedFunction<AgentSettingsStorage['read']>;
}

describe('ChatWorkspaceController', () => {
  let api: WorkspaceApiMock;
  let agentSettingsStorage: AgentSettingsStorageMock;
  let profileSync: UserProfileSyncMock;
  let threadState: ChatThreadState;
  let workspace: ChatWorkspaceController;
  let routeParams: Record<string, string>;

  beforeEach(() => {
    api = createApiMock();
    agentSettingsStorage = {
      read: vi.fn(() => ({})),
    };
    profileSync = {
      loadAndHydrate: vi.fn(),
      updateAgentModel: vi.fn(),
      updateLastAgent: vi.fn(),
      updateTheme: vi.fn(),
    };
    routeParams = { agentId: 'writer', threadId: 'thread-2' };

    TestBed.configureTestingModule({
      providers: [
        ChatThreadState,
        ChatWorkspaceController,
        { provide: AssistantApi, useValue: api },
        { provide: AgentSettingsStorage, useValue: agentSettingsStorage },
        { provide: UserProfileSyncService, useValue: profileSync },
        {
          provide: ActivatedRoute,
          useValue: routeWithQueryParams(() => routeParams),
        },
      ],
    });

    threadState = TestBed.inject(ChatThreadState);
    workspace = TestBed.inject(ChatWorkspaceController);
  });

  it('loads app data and prefers a valid route agent and thread', async () => {
    const agentsResponse = agents([
      agent('scotty'),
      agent('writer', { models: { chat: 'gpt-4.1' } }),
    ]);

    api.session.mockResolvedValueOnce(session(true));
    api.health.mockResolvedValueOnce(health(agentsResponse.agents));
    api.models.mockResolvedValueOnce(models(['gpt-5-mini', 'gpt-4.1'], 'gpt-5-mini'));
    api.agents.mockResolvedValueOnce(agentsResponse);
    profileSync.loadAndHydrate.mockResolvedValueOnce(userProfile({ lastAgentId: 'scotty' }));

    const loadAgentThreads = vi
      .spyOn(threadState, 'loadAgentThreads')
      .mockResolvedValueOnce(undefined);

    await workspace.load();

    expect(workspace.isLoading()).toBe(false);
    expect(workspace.session()).toEqual(session(true));
    expect(workspace.agents()).toEqual(agentsResponse.agents);
    expect(workspace.models().map((model) => model.id)).toEqual(['gpt-5-mini', 'gpt-4.1']);
    expect(workspace.selectedModel()).toBe('gpt-4.1');
    expect(loadAgentThreads).toHaveBeenCalledWith('writer', 'thread-2');
  });

  it('falls back from route and profile agent to the default chat agent and stored model', async () => {
    routeParams = { agentId: 'missing-route', threadId: 'thread-2' };
    const agentsResponse = agents([agent('scotty'), agent('writer')]);

    api.session.mockResolvedValueOnce(session(true));
    api.health.mockResolvedValueOnce(health(agentsResponse.agents));
    api.models.mockResolvedValueOnce(models(['gpt-5-mini', 'gpt-4.1'], 'gpt-5-mini'));
    api.agents.mockResolvedValueOnce(agentsResponse);
    profileSync.loadAndHydrate.mockResolvedValueOnce(userProfile({ lastAgentId: 'missing' }));
    agentSettingsStorage.read.mockReturnValueOnce({ model: 'gpt-4.1' });

    const loadAgentThreads = vi
      .spyOn(threadState, 'loadAgentThreads')
      .mockResolvedValueOnce(undefined);

    await workspace.load();

    expect(workspace.selectedModel()).toBe('gpt-4.1');
    expect(loadAgentThreads).toHaveBeenCalledWith('scotty', 'thread-2');
  });

  it('persists a selected model to the agent and profile when the model is available', async () => {
    const currentAgent = agent('writer', { models: { chat: 'gpt-5-mini' } });
    const updatedAgent = agent('writer', { models: { chat: 'gpt-4.1' } });

    workspace.agents.set([currentAgent]);
    workspace.models.set(modelOptions(['gpt-5-mini', 'gpt-4.1']));
    threadState.selectedAgentId.set('writer');
    api.updateAgent.mockResolvedValueOnce(updatedAgent);

    workspace.updateModel('gpt-4.1');
    await Promise.resolve();

    expect(workspace.selectedModel()).toBe('gpt-4.1');
    expect(api.updateAgent).toHaveBeenCalledWith('writer', {
      models: {
        chat: 'gpt-4.1',
      },
    });
    expect(profileSync.updateAgentModel).toHaveBeenCalledWith('writer', 'gpt-4.1');
    expect(workspace.agents()).toEqual([updatedAgent]);
  });
});

function createApiMock(): WorkspaceApiMock {
  return {
    agents: vi.fn<AssistantApi['agents']>(),
    health: vi.fn<AssistantApi['health']>(),
    login: vi.fn<AssistantApi['login']>(),
    logout: vi.fn<AssistantApi['logout']>(),
    models: vi.fn<AssistantApi['models']>(),
    session: vi.fn<AssistantApi['session']>(),
    updateAgent: vi.fn<AssistantApi['updateAgent']>(),
  };
}

function routeWithQueryParams(readParams: () => Readonly<Record<string, string>>) {
  return {
    snapshot: {
      queryParamMap: {
        get: (key: string) => readParams()[key] ?? null,
      },
    },
  };
}

function session(authenticated: boolean): AuthSessionResponse {
  return {
    authEnabled: true,
    authenticated,
    username: authenticated ? 'rolf' : undefined,
  };
}

function agent(id: string, overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id,
    name: id,
    kind: 'chat',
    chatEnabled: true,
    enabledCapabilities: [],
    attachedSkills: [],
    memory: {
      canRead: true,
      canWrite: true,
    },
    models: {},
    soulVirtualPath: '/configuration/soul.md',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

function agents(agentList: readonly AgentProfile[]): AgentsResponse {
  return {
    agents: agentList,
    defaultAgentId: 'scotty',
  };
}

function health(agentList: readonly AgentProfile[]): HealthResponse {
  return {
    ok: true,
    service: 'rdma26-backend',
    agents: agentList,
    defaultAgentId: 'scotty',
    apiKeyConfigured: true,
    chatGptAuthenticated: false,
    authEnabled: true,
    dataDir: '/tmp/rdma26',
  };
}

function models(ids: readonly string[], defaultModel: string): ModelsResponse {
  return {
    models: modelOptions(ids),
    defaultModel,
  };
}

function modelOptions(ids: readonly string[]): readonly ModelOption[] {
  return ids.map((id) => ({
    id,
    label: id,
    model: id,
    provider: 'openai-api',
    authMethod: 'api_key',
  }));
}

function userProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    name: '',
    timeZone: 'Europe/Berlin',
    language: 'de',
    locale: 'de-DE',
    dateStyle: 'medium',
    timeStyle: 'short',
    theme: 'system',
    agentSettings: {},
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}
