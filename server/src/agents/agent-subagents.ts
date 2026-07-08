import type { SubAgent } from 'deepagents';

import type { UserProfile } from '../../../shared/agent-contracts';
import { researchCapabilityId } from '../capabilities/capability-registry';
import { createResearchSubagents } from '../research/research-agent';
import { TavilySearchProvider } from '../research/tavily-search-provider';

export function createEnabledSubagents(
  enabledToolIds: readonly string[],
  userProfile: UserProfile,
): readonly SubAgent[] {
  if (!enabledToolIds.includes(researchCapabilityId)) {
    return [];
  }

  const tavilyApiKey = process.env['TAVILY_API_KEY'];

  if (!tavilyApiKey) {
    throw new Error('TAVILY_API_KEY is required to use the research capability.');
  }

  return createResearchSubagents(new TavilySearchProvider(tavilyApiKey), userProfile);
}
