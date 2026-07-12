export const evaluationSuiteVersion = '2026-07-12-v3';

export type EvaluationCategory =
  'direct' | 'research' | 'calculation' | 'planning' | 'uncertainty' | 'memory' | 'conversation';

export type EvaluationScenario =
  | 'single'
  | 'follow_up'
  | 'agent_local_memory'
  | 'global_memory'
  | 'irrelevant_memory'
  | 'cross_agent_isolation'
  | 'past_conversation';

export interface EvaluationAssertions {
  readonly containsAll?: readonly string[];
  readonly containsAny?: readonly string[];
  readonly excludesAll?: readonly string[];
  readonly minimumSources?: number;
  readonly sourceDomainsAny?: readonly string[];
  readonly requiredToolCalls?: readonly string[];
  readonly forbiddenToolCalls?: readonly string[];
}

export interface EvaluationStep {
  readonly id: string;
  readonly agent: 'primary' | 'secondary';
  readonly thread: 'case' | 'seed';
  readonly prompt: string;
  readonly assertions: EvaluationAssertions;
  readonly includeInScore?: boolean;
}

export interface EvaluationMemorySeed {
  readonly scope: 'user' | 'agent_user' | 'agent';
  readonly agent: 'primary' | 'secondary';
  readonly content: string;
  readonly tags: readonly string[];
  readonly pinned?: boolean;
}

export interface EvaluationCaseDefinition {
  readonly id: string;
  readonly category: EvaluationCategory;
  readonly description: string;
  readonly scenario: EvaluationScenario;
  readonly suites: readonly EvaluationSuiteId[];
  readonly requiredCapabilities: readonly string[];
  readonly memorySeeds?: readonly EvaluationMemorySeed[];
  readonly steps: readonly EvaluationStep[];
  readonly humanReview?: readonly string[];
}

export type EvaluationSuiteId = 'smoke' | 'research' | 'memory' | 'core';

const cases: readonly EvaluationCaseDefinition[] = [
  {
    id: 'direct-known-fact',
    category: 'direct',
    description: 'Answer a stable direct fact without external research.',
    scenario: 'single',
    suites: ['smoke', 'core'],
    requiredCapabilities: [],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt: 'What is the capital of France? Answer in one short sentence.',
        assertions: {
          containsAll: ['Paris'],
          forbiddenToolCalls: ['task', 'research', 'internet_search'],
        },
      },
    ],
  },
  {
    id: 'current-angular-version',
    category: 'research',
    description: 'Find one current software fact from an official source.',
    scenario: 'single',
    suites: ['research', 'core'],
    requiredCapabilities: ['research'],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt:
          'What is the current stable major version of Angular, when was that major version released, and which official source proves it?',
        assertions: {
          minimumSources: 1,
          sourceDomainsAny: ['angular.dev', 'blog.angular.dev', 'github.com'],
          requiredToolCalls: ['task'],
        },
      },
    ],
    humanReview: [
      'The reported version and date are current at evaluation time.',
      'The cited official source directly supports both values.',
    ],
  },
  {
    id: 'multi-source-current-fact',
    category: 'research',
    description: 'Answer a current fact with independent source support.',
    scenario: 'single',
    suites: ['research', 'core'],
    requiredCapabilities: ['research'],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt:
          'What was the most recently completed match of the 2026 FIFA World Cup, and what was the final result? Verify it with at least two directly relevant sources.',
        assertions: {
          minimumSources: 2,
          requiredToolCalls: ['task'],
        },
      },
    ],
    humanReview: [
      'The selected match was actually the latest completed match at run time.',
      'Both displayed sources support the match and final result.',
    ],
  },
  {
    id: 'deterministic-calculation',
    category: 'calculation',
    description: 'Calculate a stable numeric result.',
    scenario: 'single',
    suites: ['smoke', 'core'],
    requiredCapabilities: [],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt: 'Calculate (37 × 19) + 31. Return the result and the expression.',
        assertions: {
          containsAll: ['734'],
          forbiddenToolCalls: ['task', 'research', 'internet_search'],
        },
      },
    ],
  },
  {
    id: 'research-plus-calculation',
    category: 'calculation',
    description: 'Combine source-backed current data with a derived calculation.',
    scenario: 'single',
    suites: ['research', 'core'],
    requiredCapabilities: ['research'],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt:
          'Using the official OpenAI API pricing page, find the current input and output prices for gpt-5.4 and calculate the estimated cost of 1,000,000 uncached input tokens plus 100,000 output tokens. Show the sourced prices separately from your calculation.',
        assertions: {
          minimumSources: 1,
          sourceDomainsAny: ['openai.com'],
          requiredToolCalls: ['task'],
        },
      },
    ],
    humanReview: [
      'The current official prices were extracted correctly.',
      'The calculation is reproducible from the displayed prices.',
      'Sourced facts and the derived result are clearly separated.',
    ],
  },
  {
    id: 'interpreter-structured-transformation',
    category: 'calculation',
    description: 'Use isolated code for a deterministic structured-data transformation.',
    scenario: 'single',
    suites: ['core'],
    requiredCapabilities: ['interpreter'],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt:
          'Use the interpreter to sort these records by score descending and calculate the average score: Atlas 91, Birch 73, Cedar 82. Return the ordered names and average.',
        assertions: {
          containsAll: ['Atlas', 'Cedar', 'Birch', '82'],
          requiredToolCalls: ['eval'],
          forbiddenToolCalls: ['task', 'research', 'internet_search'],
        },
      },
    ],
  },
  {
    id: 'multi-step-plan',
    category: 'planning',
    description: 'Complete a request with dependent research and synthesis steps.',
    scenario: 'single',
    suites: ['research', 'core'],
    requiredCapabilities: ['research'],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt:
          'Find the next scheduled 2026 FIFA World Cup match, give its kickoff time in Europe/Berlin, and explain which sourced value you used before conversion. If the source time zone is unclear, say so instead of guessing.',
        assertions: {
          minimumSources: 1,
          requiredToolCalls: ['task'],
        },
      },
    ],
    humanReview: [
      'The agent identified the correct next scheduled match at run time.',
      'The source time and zone are supported before any conversion.',
      'The local time is correct or explicitly unresolved.',
    ],
  },
  {
    id: 'explicit-uncertainty',
    category: 'uncertainty',
    description: 'Refuse to invent an unknowable exact future outcome.',
    scenario: 'single',
    suites: ['smoke', 'core'],
    requiredCapabilities: [],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt:
          'I will flip a fair coin tomorrow. Tell me the exact result now. Do not give probabilities; state what can actually be known.',
        assertions: {
          containsAny: [
            'cannot know',
            'cannot be known',
            "can't know",
            'not possible to know',
            'unknown',
          ],
          forbiddenToolCalls: ['task', 'research', 'internet_search'],
        },
      },
    ],
  },
  {
    id: 'agent-local-memory-recall',
    category: 'memory',
    description: 'Recall semantically relevant agent-local memory in a new thread.',
    scenario: 'agent_local_memory',
    suites: ['memory', 'core'],
    requiredCapabilities: [],
    memorySeeds: [
      {
        scope: 'agent_user',
        agent: 'primary',
        content: "The evaluation user's private project codename is CEDAR-481.",
        tags: ['evaluation', 'project'],
      },
    ],
    steps: [
      {
        id: 'recall',
        agent: 'primary',
        thread: 'case',
        prompt: 'What is the private codename of my project?',
        assertions: {
          containsAll: ['CEDAR-481'],
          requiredToolCalls: ['search_unpinned_memory'],
        },
      },
    ],
  },
  {
    id: 'global-memory-recall',
    category: 'memory',
    description: 'Recall global user memory from two different agents.',
    scenario: 'global_memory',
    suites: ['memory', 'core'],
    requiredCapabilities: [],
    memorySeeds: [
      {
        scope: 'user',
        agent: 'primary',
        content: "The evaluation user's shared marker is GLOBAL-593.",
        tags: ['evaluation', 'shared'],
      },
    ],
    steps: [
      {
        id: 'primary-recall',
        agent: 'primary',
        thread: 'case',
        prompt: 'What is my shared evaluation marker?',
        assertions: {
          containsAll: ['GLOBAL-593'],
          requiredToolCalls: ['search_unpinned_memory'],
        },
      },
      {
        id: 'secondary-recall',
        agent: 'secondary',
        thread: 'case',
        prompt: 'What is my shared evaluation marker?',
        assertions: {
          containsAll: ['GLOBAL-593'],
          requiredToolCalls: ['search_unpinned_memory'],
        },
      },
    ],
  },
  {
    id: 'irrelevant-memory-exclusion',
    category: 'memory',
    description: 'Do not retrieve unrelated memory for a self-contained question.',
    scenario: 'irrelevant_memory',
    suites: ['memory', 'core'],
    requiredCapabilities: [],
    memorySeeds: [
      {
        scope: 'agent_user',
        agent: 'primary',
        content: 'The unrelated evaluation restaurant marker is IRRELEVANT-884.',
        tags: ['evaluation', 'restaurant'],
      },
    ],
    steps: [
      {
        id: 'answer',
        agent: 'primary',
        thread: 'case',
        prompt: 'What is 12 + 30?',
        assertions: {
          containsAll: ['42'],
          excludesAll: ['IRRELEVANT-884'],
          forbiddenToolCalls: ['search_unpinned_memory'],
        },
      },
    ],
  },
  {
    id: 'cross-agent-memory-isolation',
    category: 'memory',
    description: "Do not expose one agent's local memory to another agent.",
    scenario: 'cross_agent_isolation',
    suites: ['memory', 'core'],
    requiredCapabilities: [],
    memorySeeds: [
      {
        scope: 'agent_user',
        agent: 'primary',
        content: "The primary agent's isolated evaluation marker is PRIVATE-267.",
        tags: ['evaluation', 'private'],
      },
    ],
    steps: [
      {
        id: 'secondary-query',
        agent: 'secondary',
        thread: 'case',
        prompt: "What is the other agent's isolated evaluation marker?",
        assertions: {
          excludesAll: ['PRIVATE-267'],
        },
      },
    ],
    humanReview: ["The secondary agent does not imply that it accessed another agent's memory."],
  },
  {
    id: 'thread-follow-up',
    category: 'conversation',
    description: 'Use prior context in the same thread without external memory.',
    scenario: 'follow_up',
    suites: ['smoke', 'core'],
    requiredCapabilities: [],
    steps: [
      {
        id: 'seed',
        agent: 'primary',
        thread: 'case',
        prompt: 'For the next message in this thread, remember the temporary marker ORBIT-742.',
        assertions: {},
        includeInScore: false,
      },
      {
        id: 'follow-up',
        agent: 'primary',
        thread: 'case',
        prompt: 'What temporary marker did I give you in the previous message?',
        assertions: {
          containsAll: ['ORBIT-742'],
          forbiddenToolCalls: ['search_unpinned_memory', 'search_past_conversations'],
        },
      },
    ],
  },
  {
    id: 'past-conversation-recall',
    category: 'conversation',
    description: 'Find relevant information in an earlier thread on demand.',
    scenario: 'past_conversation',
    suites: ['memory', 'core'],
    requiredCapabilities: [],
    steps: [
      {
        id: 'seed-thread',
        agent: 'primary',
        thread: 'seed',
        prompt:
          'This earlier conversation uses the temporary historical marker HISTORY-731. Acknowledge it without saving long-term memory.',
        assertions: {},
        includeInScore: false,
      },
      {
        id: 'recall',
        agent: 'primary',
        thread: 'case',
        prompt:
          'Search our earlier conversations and tell me the temporary historical marker from the previous thread.',
        assertions: {
          containsAll: ['HISTORY-731'],
          requiredToolCalls: ['search_past_conversations'],
        },
      },
    ],
  },
];

export function listEvaluationCases(): readonly EvaluationCaseDefinition[] {
  return cases;
}

export function selectEvaluationCases(
  suite: EvaluationSuiteId,
  caseIds: readonly string[] = [],
): readonly EvaluationCaseDefinition[] {
  const selected = caseIds.length
    ? cases.filter((definition) => caseIds.includes(definition.id))
    : cases.filter((definition) => definition.suites.includes(suite));
  const missing = caseIds.filter(
    (caseId) => !selected.some((definition) => definition.id === caseId),
  );

  if (missing.length) {
    throw new Error(`Unknown evaluation case: ${missing.join(', ')}.`);
  }

  return selected;
}
