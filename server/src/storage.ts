import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
}

export interface AssistantStorageOptions {
  readonly migrateLegacyData: boolean;
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
  return `# soul.md

You are ${agent.name}.

## Operating principles

- Treat memory as important. Save durable preferences, facts, and working agreements when Rolf asks you to remember them or when they will clearly help future conversations.
- Keep private information on the local machine unless Rolf explicitly asks you to use an external service.
- Be practical, direct, and warm. Prefer concrete next steps over vague reflection.
- Use /memories/soul.md for long-lived identity, preferences, and working agreements.
`;
}

export function createAssistantStorage(
  dataDir: string,
  agent: AgentProfile,
  options: AssistantStorageOptions = { migrateLegacyData: false },
): AssistantStorage {
  const agentDataDir = join(dataDir, 'agents', agent.id);
  const threadsDir = join(agentDataDir, 'threads');
  const deepAgentRootDir = join(agentDataDir, 'deepagent');
  const memoryDir = join(deepAgentRootDir, 'memories');
  const soulPath = join(memoryDir, 'soul.md');
  const legacySoulPath = join(dataDir, 'deepagent', 'memories', 'soul.md');
  const legacyThreadsDir = join(dataDir, 'threads');
  const legacyMigrationMarkerPath = join(agentDataDir, '.legacy-migration-complete');

  return {
    dataDir,
    agent,
    agentDataDir,
    deepAgentRootDir,
    soulPath,
    async ensureReady() {
      await mkdir(threadsDir, { recursive: true });
      await mkdir(memoryDir, { recursive: true });

      if (options.migrateLegacyData) {
        await migrateLegacyDataOnce({
          agentDataDir,
          agentId: agent.id,
          legacyMigrationMarkerPath,
          legacySoulPath,
          legacyThreadsDir,
          soulPath,
          threadsDir,
        });
      }

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

async function migrateLegacyFile(fromPath: string, toPath: string): Promise<void> {
  if (await pathExists(toPath)) {
    return;
  }

  if (!(await pathExists(fromPath))) {
    return;
  }

  await mkdir(dirname(toPath), { recursive: true });
  await cp(fromPath, toPath);
}

interface LegacyMigrationOptions {
  readonly agentDataDir: string;
  readonly agentId: string;
  readonly legacyMigrationMarkerPath: string;
  readonly legacySoulPath: string;
  readonly legacyThreadsDir: string;
  readonly soulPath: string;
  readonly threadsDir: string;
}

async function migrateLegacyDataOnce(options: LegacyMigrationOptions): Promise<void> {
  if (await pathExists(options.legacyMigrationMarkerPath)) {
    return;
  }

  if ((await pathExists(options.soulPath)) || (await hasThreadFiles(options.threadsDir))) {
    await writeMigrationMarker(options.legacyMigrationMarkerPath);

    return;
  }

  await migrateLegacyFile(options.legacySoulPath, options.soulPath);
  await migrateLegacyThreads(options.legacyThreadsDir, options.threadsDir, options.agentId);
  await writeMigrationMarker(options.legacyMigrationMarkerPath);
}

async function writeMigrationMarker(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${new Date().toISOString()}\n`, 'utf8');
}

async function hasThreadFiles(threadsDir: string): Promise<boolean> {
  try {
    const fileNames = await readdir(threadsDir);

    return fileNames.some((fileName) => fileName.endsWith('.json'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function migrateLegacyThreads(
  fromDir: string,
  toDir: string,
  agentId: string,
): Promise<void> {
  if (!(await pathExists(fromDir))) {
    return;
  }

  const fileNames = await readdir(fromDir);
  await mkdir(toDir, { recursive: true });

  await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        const targetPath = join(toDir, fileName);

        if (!(await pathExists(targetPath))) {
          const thread = toChatThread(await readThreadFile(join(fromDir, fileName)), agentId);
          await writeThread(toDir, thread);
        }
      }),
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);

    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
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
