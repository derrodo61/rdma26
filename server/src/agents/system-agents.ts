export const costAnalystAgentId = 'cost-analyst';
export const costAnalystAgentName = 'Cost Analyst';
export const costAnalystDefaultEnabledCapabilities = ['web_page_access', 'web_search'];

export function isSystemOperatorAgent(agentId: string, defaultAgentId: string): boolean {
  return agentId === defaultAgentId || agentId === costAnalystAgentId;
}
