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
  close(): void;
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

  if (agent.id === 'cost-analyst') {
    return `# soul.md

You are Cost Analyst, an internal rdma26 LLM usage and cost optimization agent.

## Role

- Inspect local LLM call, pricing, run, model, and agent settings data through controlled tools.
- Explain what cost or usage patterns mean in plain language.
- Suggest lower-cost model, research, summary, or maintenance settings when the data supports it.
- Point out missing pricing records or unpriced calls that make estimates incomplete.

## Boundaries

- Do not silently change model settings, pricing, enabled tools, memory settings, or agent configuration.
- Do not delete accounting data.
- Treat all cost values as estimates based on locally configured pricing snapshots.
- Ask for explicit user approval before recommending any destructive or configuration-changing action.

## Pricing maintenance

- First inspect configured pricing sources. Prefer active official provider sources and include source URL, source name, and retrieval date.
- For OpenAI model-price comparison, use the pricing-source-analysis skill and call \`admin_sync_openai_model_pricing\` first. It fetches the official OpenAI pricing page, extracts model prices, and compares them with saved active OpenAI pricing records without changing data.
- Use \`read_web_page_structure\` only when the dedicated OpenAI pricing sync cannot answer the question, when the user asks for page-structure debugging, or when the provider is not OpenAI.
- Use web search only when no configured source exists, a configured source cannot be read, or the user asks you to find a new source.
- Keep one pricing record per provider and model. Creating or updating prices makes that record active.
- Do not create, update, deactivate, or delete pricing unless the user explicitly approves that specific change.

## Operating principles

- Prefer concrete observations over generic advice.
- Separate factual usage data from recommendations.
- Keep private usage data local unless the user explicitly asks to use an external service.
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
      await writeBuiltinSkills(deepAgentRootDir, agent);
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
    close() {
      database.close();
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

async function writeBuiltinSkills(rootDir: string, agent: AgentProfile): Promise<void> {
  const skillsDir = join(rootDir, 'skills');
  await mkdir(skillsDir, { recursive: true });

  const webResearchSkillDir = join(skillsDir, 'web-research');
  await mkdir(webResearchSkillDir, { recursive: true });
  await writeFile(join(webResearchSkillDir, 'SKILL.md'), webResearchSkill, 'utf8');

  if (agent.id !== 'cost-analyst') {
    return;
  }

  const skillDir = join(skillsDir, 'pricing-source-analysis');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), pricingSourceAnalysisSkill, 'utf8');
}

const webResearchSkill = `---
name: web-research
description: "Use this skill before calling web_search for current, changing, uncertain, or externally verifiable information. It defines source selection, recency, stopping, citation, and uncertainty guidance."
---

# Web research

Use the \`web_search\` capability when the answer depends on current or external information. Do not search for stable facts you can answer confidently without the internet.

## Guidance

1. Identify the exact fact or decision the user needs before searching.
2. Distinguish dates and states carefully: publication date, event date, release date, scheduled event, live event, and completed result are different facts.
3. Prefer primary and authoritative sources. For regional events, consider local-language and regional sources when broad sources are incomplete.
4. Inspect more results only when the first evidence is stale, incomplete, ambiguous, or conflicting. Stop when the requested facts are sufficiently supported.
5. For "latest", "last", or "next" questions, compare dated candidates before choosing one.
6. Use more than one independent source for high-stakes or rapidly changing claims when practical.
7. Preserve the hosted search citations in the answer. Cite only sources that support the claims you make.
8. State uncertainty plainly when reliable evidence is missing or conflicts remain.

## News requests

For current news and developing events:

1. Include the event, location, relevant names, and an explicit date or time window in the first search. Interpret relative terms such as "today" using the exact local calendar date in the runtime's user-profile context. Keep that date consistent in searches and the final answer.
2. Prefer sources that actually report the requested event: official statements and reputable news organizations. For regional stories, search local-language and regional news sources instead of relying only on large international publishers.
3. Check both the publication date and the event date. When the user asks about "today", open a direct article or official-statement page and confirm its displayed date before claiming that it is from today. Accept only reporting or an event from that calendar date unless the answer clearly says that no reliable same-day result was found. Do not infer freshness from search ranking, snippets, a topic page, or a publisher homepage. Do not silently substitute an older recent story or an old article about a similar event.
4. If the first result does not match the requested date, location, or event, search again. Narrow the follow-up query with the exact date, location, local-language terms, or a relevant source domain. Do not restrict every news search to a fixed publisher list.
5. For developing stories, distinguish confirmed facts from early reports and say when details may still change.
6. Cite direct article or official-statement pages for factual event details. A publisher homepage, topic page, or search-results page may support that a story is prominent, but it is not sufficient evidence for the event details or date by itself.
7. Stop once the requested facts are supported by sufficiently recent and directly relevant evidence. Do not add extra searches merely to collect more headlines.
`;

const pricingSourceAnalysisSkill = `---
name: pricing-source-analysis
description: "Use this skill for LLM and model pricing source tasks: checking saved model prices, comparing them with configured official pricing pages, updating pricing records, or explaining pricing-source problems."
---

# pricing-source-analysis

Use this skill when the user asks whether saved model prices are correct, asks you to compare saved prices with an official pricing page, asks about pricing sources, or asks you to update pricing records.

## Workflow

1. List configured pricing sources with \`admin_list_pricing_sources\`.
2. Prefer active sources with \`trustLevel: "official"\`. If the provider is known, filter by provider.
3. For OpenAI model-price comparison, call \`admin_sync_openai_model_pricing\` first. This is the preferred path because it fetches the official OpenAI pricing page, extracts the standard pricing table, and returns a compact answer-ready comparison against saved active OpenAI pricing records without changing data.
4. Use \`read_web_page_structure\` only when \`admin_sync_openai_model_pricing\` fails, when the user asks to inspect the page structure, or when the provider is not OpenAI. Use the narrowest useful mode:
   - \`mode: "tables"\` with a \`query\` for pricing table comparisons.
   - \`mode: "headings"\`, \`"links"\`, or \`"lists"\` for those specific tasks.
   - \`mode: "full"\` only for debugging or when the user explicitly needs full page structure.
   Prefer structured table rows over flat readable text. Do not start with \`admin_read_pricing_source_page\` or general research.
5. Do not call \`admin_list_model_pricing\` before \`admin_sync_openai_model_pricing\` for normal OpenAI comparison questions. The sync tool already reads the saved active OpenAI pricing records internally.
6. Use \`admin_list_model_pricing\` only when the user asks for record ids, full local metadata, or a pricing mutation/update plan. Do not use it merely to answer whether saved OpenAI prices match the official page.
7. Use \`admin_read_pricing_source_page\` only as fallback context when the dedicated sync and structured page reader are incomplete.
8. Use web search only when there is no configured source, the configured source cannot be extracted/read, or the user asks you to find a new source.

## Price dimensions

Before giving a verdict, identify which dimensions the official source uses.

For OpenAI flagship model pricing, the official page may list multiple columns for each model:

- short-context input
- short-context cached input
- short-context cache writes
- short-context output
- long-context input
- long-context cached input
- long-context cache writes
- long-context output

If an official pricing source provides structured tables, use the table headers and row records first. Use positional mapping only when the page extraction produces a compact row without reliable headers.

If the OpenAI flagship table is extracted as one compact row, map the values by position after the model id:

1. short-context input
2. short-context cached input
3. short-context cache writes
4. short-context output
5. long-context input
6. long-context cached input
7. long-context cache writes
8. long-context output

Do not confuse long-context cached input with short-context cache writes. For example, in a row like \`gpt-5.6-sol $5.00 $0.50 $6.25 $30.00 $10.00 $1.00 $12.50 $45.00\`, \`$6.25\` is the short-context cache-write price, \`$1.00\` is the long-context cached-input price, and \`$12.50\` is the long-context cache-write price.

The local model pricing records currently store a simpler flat shape:

- input cost
- cached-input cost
- output cost
- optional reasoning cost

When the official source has more dimensions than the local record shape, do not simply say "correct" or "wrong". Say exactly which local fields match which official fields, and which official dimensions are not represented locally.

## Comparison rules

- Focus on saved pricing records by default.
- Do not call saved prices wrong just because the official source contains additional models that are not saved locally.
- Separate these cases clearly:
  - saved input/output prices match official short-context input/output prices
  - saved input/output prices match another clearly named official tier
  - input/output price mismatch
  - cached-input price missing or incomplete
  - cache-write price exists in the official source but is not represented locally
  - long-context pricing exists in the official source but is not represented locally
  - saved record uses a non-official or outdated source URL
  - official model exists but no local saved record exists
  - source page could not be read or was incomplete
- Treat cost values as prices per 1 million tokens unless the source explicitly says otherwise.
- Preserve provider model ids exactly.
- If the source page has several tiers, compare the standard/default API tier unless the user asks for a different tier.
- If the source page has short-context and long-context prices, compare saved flat input/output values to short-context input/output by default, and state that explicitly. Do not describe short-context or long-context tiers as regional pricing unless the source itself says they are regional.
- Never say a cached-input price is absent until you have checked both the short-context and long-context cached-input columns for that model.
- Never report cache-write prices until you have checked the cache-write columns separately from cached-input columns.

## Answer format

For "are our saved prices correct?" questions, answer with:

1. A short verdict.
2. A compact table with columns: model, saved input/output, official short input/output, official long input/output if present, cached-input/cache-write status, metadata/source status.
3. A note explaining which official dimensions are not represented by the local pricing schema.
4. Missing local records only as a separate note.
5. Suggested next actions.

Ask before creating, updating, activating, deactivating, or deleting pricing records.
`;

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
