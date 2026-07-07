import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  AgentProfile,
  ChatMessage,
  ChatThread,
  ChatThreadSummary,
} from '../../shared/agent-contracts';

export interface AssistantStorage {
  readonly dataDir: string;
  readonly agent: AgentProfile;
  readonly agentDataDir: string;
  readonly deepAgentRootDir: string;
  readonly soulPath: string;
  ensureReady(): Promise<void>;
  listThreads(): Promise<ChatThreadSummary[]>;
  createThread(title?: string): Promise<ChatThread>;
  readThread(threadId: string): Promise<ChatThread | null>;
  deleteThread(threadId: string): Promise<boolean>;
  appendMessage(
    threadId: string,
    message: Omit<ChatMessage, 'id' | 'createdAt'>,
  ): Promise<ChatThread>;
  readSoul(): Promise<string>;
  writeSoul(content: string): Promise<void>;
}

interface StoredThreadFile {
  readonly id: string;
  readonly agentId?: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessage[];
}

function createDefaultSoul(agent: AgentProfile): string {
  if (agent.name === 'Scotty') {
    return `# soul.md

You are Scotty, Rolf's local personal AI system engineer and protected operator agent.

## Role

- Help Rolf administer this local multi-agent system through controlled backend tools.
- Create and configure specialist agents when Rolf asks for them.
- Manage tool grants carefully and explain what changed.
- Keep normal agents focused on their own roles; use Scotty for system-level operations.

## Operating principles

- Do not claim shell or raw CLI access. You only have the controlled tools exposed to you.
- Use soul.md for stable identity, role, personality, and operating principles. Do not use it for arbitrary memories or transient facts.
- Keep private information on the local machine unless Rolf explicitly asks you to use an external service.
- Be practical, direct, and warm. Prefer concrete next steps over vague reflection.
`;
  }

  return `# soul.md

You are ${agent.name}.

## Operating principles

- Use soul.md for stable identity, role, personality, and operating principles. Do not use it for arbitrary memories or transient facts.
- Keep private information on the local machine unless Rolf explicitly asks you to use an external service.
- Be practical, direct, and warm. Prefer concrete next steps over vague reflection.
`;
}

export function createAssistantStorage(dataDir: string, agent: AgentProfile): AssistantStorage {
  const agentDataDir = join(dataDir, 'agents', agent.id);
  const threadsDir = join(agentDataDir, 'threads');
  const configurationDir = join(agentDataDir, 'configuration');
  const deepAgentRootDir = join(agentDataDir, 'deepagent');
  const memoryDir = join(deepAgentRootDir, 'memories');
  const soulPath = join(configurationDir, 'soul.md');

  return {
    dataDir,
    agent,
    agentDataDir,
    deepAgentRootDir,
    soulPath,
    async ensureReady() {
      await mkdir(threadsDir, { recursive: true });
      await mkdir(configurationDir, { recursive: true });
      await mkdir(memoryDir, { recursive: true });
      await writeIfMissing(soulPath, createDefaultSoul(agent));
    },
    async listThreads() {
      await this.ensureReady();
      const fileNames = await readdir(threadsDir);
      const threads = await Promise.all(
        fileNames
          .filter((fileName) => fileName.endsWith('.json'))
          .map(async (fileName) => readThreadFile(join(threadsDir, fileName))),
      );

      return threads
        .map((thread) => toThreadSummary(thread, agent.id))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async createThread(title) {
      await this.ensureReady();
      const now = new Date().toISOString();
      const thread: ChatThread = {
        id: crypto.randomUUID(),
        agentId: agent.id,
        title: normalizeTitle(title) ?? 'New conversation',
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        messages: [],
      };
      await writeThread(threadsDir, thread);

      return thread;
    },
    async readThread(threadId) {
      await this.ensureReady();

      try {
        return toChatThread(await readThreadFile(threadPath(threadsDir, threadId)), agent.id);
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return null;
        }

        throw error;
      }
    },
    async deleteThread(threadId) {
      await this.ensureReady();

      try {
        await rm(threadPath(threadsDir, threadId));

        return true;
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return false;
        }

        throw error;
      }
    },
    async appendMessage(threadId, message) {
      const thread = await this.readThread(threadId);

      if (!thread) {
        throw new Error(`Thread ${threadId} does not exist.`);
      }

      const now = new Date().toISOString();
      const nextMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: message.role,
        content: message.content,
        createdAt: now,
      };
      const nextThread: ChatThread = {
        ...thread,
        title:
          thread.title === 'New conversation' && message.role === 'user'
            ? titleFromPrompt(message.content)
            : thread.title,
        updatedAt: now,
        messageCount: thread.messages.length + 1,
        messages: [...thread.messages, nextMessage],
      };

      await writeThread(threadsDir, nextThread);

      return nextThread;
    },
    async readSoul() {
      await this.ensureReady();

      return await readFile(soulPath, 'utf8');
    },
    async writeSoul(content) {
      await this.ensureReady();
      await writeFile(soulPath, content, 'utf8');
    },
  };
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  try {
    await readFile(path, 'utf8');
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
}

async function readThreadFile(path: string): Promise<StoredThreadFile> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;

  if (!isStoredThreadFile(raw)) {
    throw new Error(`Invalid thread file: ${path}`);
  }

  return raw;
}

async function writeThread(threadsDir: string, thread: ChatThread): Promise<void> {
  await writeFile(
    threadPath(threadsDir, thread.id),
    `${JSON.stringify(thread, null, 2)}\n`,
    'utf8',
  );
}

function threadPath(threadsDir: string, threadId: string): string {
  return join(threadsDir, `${threadId}.json`);
}

function toThreadSummary(thread: StoredThreadFile, fallbackAgentId: string): ChatThreadSummary {
  return {
    id: thread.id,
    agentId: thread.agentId ?? fallbackAgentId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
  };
}

function toChatThread(thread: StoredThreadFile, fallbackAgentId: string): ChatThread {
  return {
    ...toThreadSummary(thread, fallbackAgentId),
    messages: thread.messages,
  };
}

function normalizeTitle(title: string | undefined): string | undefined {
  const normalized = title?.trim();

  return normalized ? normalized : undefined;
}

function titleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');

  return trimmed.length > 48 ? `${trimmed.slice(0, 45)}...` : trimmed;
}

function isStoredThreadFile(value: unknown): value is StoredThreadFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'title' in value &&
    'createdAt' in value &&
    'updatedAt' in value &&
    'messages' in value &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.messages)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
