export type AgentActivityCallback = (activity: {
  readonly label: string;
  readonly detail?: string;
}) => void;

export async function observeAgentRunActivity(
  run: AgentRunStreamLike,
  onActivity?: AgentActivityCallback,
): Promise<void> {
  if (!onActivity) {
    return;
  }

  await Promise.allSettled([
    observeToolCalls(run.toolCalls, onActivity),
    observeSubagents(run.subagents, onActivity),
  ]);
}

export async function waitForActivityObserver(observer: Promise<void>): Promise<void> {
  await Promise.race([
    observer,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 1_000);
    }),
  ]);
}

export function emitActivity(
  onActivity: AgentActivityCallback | undefined,
  activity: { readonly label: string; readonly detail?: string },
): void {
  onActivity?.(activity);
}

async function observeToolCalls(
  toolCalls: AsyncIterable<ToolCallStreamLike> | undefined,
  onActivity: AgentActivityCallback,
): Promise<void> {
  if (!toolCalls) {
    return;
  }

  for await (const toolCall of toolCalls) {
    if (toolCall.name === 'task') {
      const subagentType = readStringProperty(toolCall.input, 'subagent_type');
      emitActivity(onActivity, {
        label: subagentType
          ? `Delegated work to ${formatSubagentName(subagentType)}`
          : 'Delegated work to a subagent',
      });
    } else {
      emitActivity(onActivity, {
        label: `Using ${formatToolName(toolCall.name)}`,
      });
    }
  }
}

async function observeSubagents(
  subagents: AsyncIterable<SubagentRunStreamLike> | undefined,
  onActivity: AgentActivityCallback,
): Promise<void> {
  if (!subagents) {
    return;
  }

  for await (const subagent of subagents) {
    const subagentName = formatSubagentName(subagent.name);
    emitActivity(onActivity, {
      label: `${subagentName} started`,
    });

    void observeSubagentToolCalls(subagent, onActivity);
    void subagent.output.then(
      () =>
        emitActivity(onActivity, {
          label: `${subagentName} returned findings`,
        }),
      () =>
        emitActivity(onActivity, {
          label: `${subagentName} stopped with an error`,
        }),
    );
  }
}

async function observeSubagentToolCalls(
  subagent: SubagentRunStreamLike,
  onActivity: AgentActivityCallback,
): Promise<void> {
  for await (const toolCall of subagent.toolCalls ?? []) {
    if (toolCall.name === 'research_web_search') {
      emitActivity(onActivity, {
        label: 'Researcher is searching the web',
        detail: readStringProperty(toolCall.input, 'query'),
      });
      continue;
    }

    if (toolCall.name === 'research_read_web_page') {
      emitActivity(onActivity, {
        label: 'Researcher is reading a source',
        detail: readStringProperty(toolCall.input, 'url'),
      });
      continue;
    }

    emitActivity(onActivity, {
      label: `${formatSubagentName(subagent.name)} is using ${formatToolName(toolCall.name)}`,
    });
  }
}

function formatSubagentName(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ');
}

function readStringProperty(value: unknown, key: string): string | undefined {
  const property = readProperty<unknown>(value, key);

  return typeof property === 'string' && property.trim() ? property : undefined;
}

function readProperty<T>(value: unknown, key: string): T | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, T>)[key];
}

interface AgentRunStreamLike {
  readonly output: Promise<unknown>;
  readonly toolCalls?: AsyncIterable<ToolCallStreamLike>;
  readonly subagents?: AsyncIterable<SubagentRunStreamLike>;
}

interface SubagentRunStreamLike {
  readonly name: string;
  readonly output: Promise<unknown>;
  readonly toolCalls?: AsyncIterable<ToolCallStreamLike>;
}

interface ToolCallStreamLike {
  readonly name: string;
  readonly input: unknown;
}
