import {
  createVerifyCurrentFactsDependencies,
  verifyCurrentFacts,
  type VerifiedFactFinding,
  type VerifiedFactsResult,
  type VerifiedFactSearch,
  type VerifiedFactSource,
  type VerifyCurrentFactsDependencyOptions,
  type VerifyCurrentFactsDependencies,
  type VerifyCurrentFactsRequest,
} from './tools/current-facts-verifier';
import type { SearchProvider, SearchTopic } from './tools/search-provider';

export type ResearchMode = 'auto' | 'quick' | 'deep';
export type ResearchModeUsed = 'quick' | 'deep';
export type ResearchExpectedOutput = 'answer' | 'structured_facts' | 'report';
export type ResearchStatus = VerifiedFactsResult['status'];

export interface ResearchRequest {
  readonly question: string;
  readonly mode?: ResearchMode;
  readonly expectedOutput?: ResearchExpectedOutput;
  readonly requiredItems?: number;
  readonly requiredFields?: readonly string[];
  readonly topic?: SearchTopic;
  readonly maxSearches?: number;
  readonly maxSources?: number;
}

export interface ResearchResult {
  readonly status: ResearchStatus;
  readonly answer: string;
  readonly findings: readonly VerifiedFactFinding[];
  readonly unresolved: readonly string[];
  readonly sources: readonly VerifiedFactSource[];
  readonly searches: readonly VerifiedFactSearch[];
  readonly notes: readonly string[];
  readonly modeUsed: ResearchModeUsed;
}

export interface ResearchAgentOptions {
  readonly searchProvider?: SearchProvider;
  readonly verifyCurrentFactsDependencies?: VerifyCurrentFactsDependencies;
  readonly dependencyOptions?: VerifyCurrentFactsDependencyOptions;
}

export class ResearchAgent {
  constructor(private readonly options: ResearchAgentOptions = {}) {}

  async research(request: ResearchRequest): Promise<ResearchResult> {
    const selectedMode = selectResearchMode(request);

    if (selectedMode === 'deep') {
      return {
        status: 'unresolved',
        answer: '',
        findings: [],
        unresolved: ['Deep research mode is not implemented yet.'],
        sources: [],
        searches: [],
        notes: [
          'Use quick mode for precise factual answers until deep research orchestration is available.',
        ],
        modeUsed: 'deep',
      };
    }

    return await this.quickFacts(request);
  }

  async quickFacts(request: VerifyCurrentFactsRequest): Promise<ResearchResult> {
    const result = await verifyCurrentFacts(request, this.dependencies());

    return {
      ...result,
      modeUsed: 'quick',
    };
  }

  private dependencies(): VerifyCurrentFactsDependencies {
    if (this.options.verifyCurrentFactsDependencies) {
      return this.options.verifyCurrentFactsDependencies;
    }

    if (!this.options.searchProvider) {
      throw new Error('A search provider is required for research.');
    }

    return createVerifyCurrentFactsDependencies(
      this.options.searchProvider,
      this.options.dependencyOptions,
    );
  }
}

function selectResearchMode(request: ResearchRequest): ResearchModeUsed {
  if (request.mode === 'deep') {
    return 'deep';
  }

  return 'quick';
}
