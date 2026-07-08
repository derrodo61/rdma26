import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  AgentProfile,
  ChatMessage,
  ChatThread,
  ChatThreadSummary,
} from '../../../shared/agent-contracts';
import { LocalDatabase } from './local-database';

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

interface ThreadRow {
  readonly id: string;
  readonly agent_id: string;
  readonly title: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly message_count: number;
}

interface MessageRow {
  readonly id: string;
  readonly role: ChatMessage['role'];
  readonly content: string;
  readonly created_at: string;
}

function createDefaultSoul(agent: AgentProfile): string {
  if (agent.name === 'Scotty') {
    return `# soul.md

You are Scotty, Rolf's local personal AI system engineer and protected operator agent.

## Role

- Help Rolf administer this local multi-agent system through controlled backend tools.
- Create and configure specialist agents when Rolf asks for them.
- Manage tool grants carefully and explain what changed.
- Inspect and manage memories through controlled tools when Rolf asks, including memory-write permissions.
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
  const soulPath = join(configurationDir, 'soul.md');
  const database = new LocalDatabase(dataDir);

  return {
    dataDir,
    agent,
    agentDataDir,
    deepAgentRootDir,
    soulPath,
    async ensureReady() {
      await mkdir(configurationDir, { recursive: true });
      await mkdir(deepAgentRootDir, { recursive: true });
      await database.ensureReady();
      await importThreadJsonFiles(database, threadsDir, agent.id);
      await writeIfMissing(soulPath, createDefaultSoul(agent));
    },
    async listThreads() {
      await this.ensureReady();
      const rows = database
        .get()
        .prepare(
          `
            select
              threads.id,
              threads.agent_id,
              threads.title,
              threads.created_at,
              threads.updated_at,
              count(messages.id) as message_count
            from threads
            left join messages on messages.thread_id = threads.id
            where threads.agent_id = ?
            group by threads.id
            order by threads.updated_at desc
          `,
        )
        .all(agent.id);

      return rows.map((row) => threadSummaryFromRow(row));
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
      insertThread(database, thread);

      return thread;
    },
    async readThread(threadId) {
      await this.ensureReady();

      return readThreadFromDatabase(database, agent.id, threadId);
    },
    async deleteThread(threadId) {
      await this.ensureReady();
      const result = database
        .get()
        .prepare('delete from threads where id = ? and agent_id = ?')
        .run(threadId, agent.id);

      return result.changes > 0;
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

      appendMessageToDatabase(database, nextThread, nextMessage);

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

function threadPath(threadsDir: string, threadId: string): string {
  return join(threadsDir, `${threadId}.json`);
}

export async function importThreadJsonFiles(
  database: LocalDatabase,
  threadsDir: string,
  agentId: string,
  markerKey = `thread_json_imported_at:${agentId}`,
): Promise<void> {
  const importMarker = database
    .get()
    .prepare('select value from schema_metadata where key = ?')
    .get(markerKey);

  if (importMarker) {
    await deleteImportedThreadJsonFiles(database, threadsDir);
    return;
  }

  const fileNames = await readJsonFileNames(threadsDir);
  const threads = await Promise.all(
    fileNames.map(async (fileName) => readThreadFile(join(threadsDir, fileName))),
  );

  for (const thread of threads) {
    insertThreadWithMessages(database, toChatThread(thread, agentId), 'insert-or-ignore');
  }

  database
    .get()
    .prepare(
      `
        insert into schema_metadata (key, value)
        values (?, ?)
      `,
    )
    .run(markerKey, new Date().toISOString());
  await deleteImportedThreadJsonFiles(database, threadsDir);
}

async function deleteImportedThreadJsonFiles(
  database: LocalDatabase,
  threadsDir: string,
): Promise<void> {
  const fileNames = await readJsonFileNames(threadsDir);

  await Promise.all(
    fileNames.map(async (fileName) => {
      const path = join(threadsDir, fileName);
      const thread = await readThreadFile(path);
      const row = database.get().prepare('select id from threads where id = ?').get(thread.id);

      if (row) {
        await rm(path, { force: true });
      }
    }),
  );
}

async function readJsonFileNames(dir: string): Promise<readonly string[]> {
  try {
    return (await readdir(dir)).filter((fileName) => fileName.endsWith('.json'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function insertThread(database: LocalDatabase, thread: ChatThread): void {
  database
    .get()
    .prepare(
      `
        insert into threads (id, agent_id, title, created_at, updated_at)
        values (?, ?, ?, ?, ?)
      `,
    )
    .run(thread.id, thread.agentId, thread.title, thread.createdAt, thread.updatedAt);
}

function insertThreadWithMessages(
  database: LocalDatabase,
  thread: ChatThread,
  mode: 'insert' | 'insert-or-ignore',
): void {
  const insertMode = mode === 'insert-or-ignore' ? 'insert or ignore' : 'insert';
  const transaction = database.get().transaction(() => {
    database
      .get()
      .prepare(
        `
          ${insertMode} into threads (id, agent_id, title, created_at, updated_at)
          values (?, ?, ?, ?, ?)
        `,
      )
      .run(thread.id, thread.agentId, thread.title, thread.createdAt, thread.updatedAt);

    for (const [index, message] of thread.messages.entries()) {
      database
        .get()
        .prepare(
          `
            ${insertMode} into messages (id, thread_id, role, content, created_at, position)
            values (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(message.id, thread.id, message.role, message.content, message.createdAt, index);
    }
  });

  transaction();
}

function appendMessageToDatabase(
  database: LocalDatabase,
  thread: ChatThread,
  message: ChatMessage,
): void {
  const position = thread.messages.length - 1;
  const transaction = database.get().transaction(() => {
    database
      .get()
      .prepare('update threads set title = ?, updated_at = ? where id = ? and agent_id = ?')
      .run(thread.title, thread.updatedAt, thread.id, thread.agentId);
    database
      .get()
      .prepare(
        `
          insert into messages (id, thread_id, role, content, created_at, position)
          values (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(message.id, thread.id, message.role, message.content, message.createdAt, position);
  });

  transaction();
}

function readThreadFromDatabase(
  database: LocalDatabase,
  agentId: string,
  threadId: string,
): ChatThread | null {
  const threadRow = database
    .get()
    .prepare('select * from threads where id = ? and agent_id = ?')
    .get(threadId, agentId);

  if (!threadRow) {
    return null;
  }

  const messageRows = database
    .get()
    .prepare('select * from messages where thread_id = ? order by position asc')
    .all(threadId);
  const messages = messageRows.map((row) => messageFromRow(row));
  const summary = threadSummaryFromRow({
    ...threadRow,
    message_count: messages.length,
  });

  return {
    ...summary,
    messages,
  };
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

function threadSummaryFromRow(row: unknown): ChatThreadSummary {
  if (!isThreadRow(row)) {
    throw new Error('Invalid thread database row.');
  }

  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count),
  };
}

function messageFromRow(row: unknown): ChatMessage {
  if (!isMessageRow(row)) {
    throw new Error('Invalid message database row.');
  }

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
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

function isThreadRow(value: unknown): value is ThreadRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ThreadRow).id === 'string' &&
    typeof (value as ThreadRow).agent_id === 'string' &&
    typeof (value as ThreadRow).title === 'string' &&
    typeof (value as ThreadRow).created_at === 'string' &&
    typeof (value as ThreadRow).updated_at === 'string' &&
    typeof (value as ThreadRow).message_count === 'number'
  );
}

function isMessageRow(value: unknown): value is MessageRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MessageRow).id === 'string' &&
    ((value as MessageRow).role === 'user' || (value as MessageRow).role === 'assistant') &&
    typeof (value as MessageRow).content === 'string' &&
    typeof (value as MessageRow).created_at === 'string'
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
