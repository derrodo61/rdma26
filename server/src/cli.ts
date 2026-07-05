import { config } from 'dotenv';

import { AssistantRuntime } from './runtime';

config({ quiet: true });

const runtime = new AssistantRuntime();

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  const options = parseOptions(args);

  await runtime.ensureReady();

  switch (command) {
    case 'agents:list':
      printJson(await runtime.agentsResponse());
      return;
    case 'agents:create':
      printJson(
        await runtime.createAgent({
          id: options['id'],
          name: requiredOption(options, 'name'),
        }),
      );
      return;
    case 'agents:update':
      printJson(
        await runtime.updateAgent(agentId(options), {
          name: requiredOption(options, 'name'),
        }),
      );
      return;
    case 'agents:delete':
      printJson(await runtime.deleteAgent(agentId(options)));
      return;
    case 'threads:list':
      printJson(await runtime.listThreads(agentId(options)));
      return;
    case 'threads:create':
      printJson(
        await runtime.createThread(agentId(options), {
          title: options['title'],
        }),
      );
      return;
    case 'threads:read':
      printJson(await runtime.readThread(agentId(options), requiredOption(options, 'thread')));
      return;
    case 'threads:delete':
      printJson(await runtime.deleteThread(agentId(options), requiredOption(options, 'thread')));
      return;
    case 'chat:send': {
      const threadId = requiredOption(options, 'thread');
      const model = options['model'] ?? runtime.modelsResponse().defaultModel;
      const prompt = requiredOption(options, 'prompt');
      const result = await runtime.runAgent({
        agentId: agentId(options),
        threadId,
        model,
        prompt,
      });

      printJson(result);
      return;
    }
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseOptions(args: readonly string[]): Record<string, string | undefined> {
  const options: Record<string, string | undefined> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf('=');

    if (equalsIndex > -1) {
      options[arg.slice(2, equalsIndex)] = arg.slice(equalsIndex + 1);
      continue;
    }

    const key = arg.slice(2);
    const value = args[index + 1];

    if (!value || value.startsWith('--')) {
      options[key] = 'true';
      continue;
    }

    options[key] = value;
    index += 1;
  }

  return options;
}

function agentId(options: Record<string, string | undefined>): string {
  return options['agent'] ?? runtime.getDefaultAgentId();
}

function requiredOption(options: Record<string, string | undefined>, key: string): string {
  const value = options[key]?.trim();

  if (!value) {
    throw new Error(`Missing required option: --${key}`);
  }

  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`rdma26 CLI

Usage:
  rdma26 agents:list
  rdma26 agents:create --id research --name "Research assistant"
  rdma26 agents:update --agent research --name "Researcher"
  rdma26 agents:delete --agent research
  rdma26 threads:list --agent default
  rdma26 threads:create --agent default --title "Planning"
  rdma26 threads:read --agent default --thread <thread-id>
  rdma26 threads:delete --agent default --thread <thread-id>
  rdma26 chat:send --agent default --thread <thread-id> --model gpt-4.1-mini --prompt "Hello"

Options:
  --agent   Agent id. Defaults to ASSISTANT_AGENT_ID or default.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'CLI command failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
