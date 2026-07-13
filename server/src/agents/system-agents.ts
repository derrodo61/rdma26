export const costAnalystAgentId = 'cost-analyst';
export const costAnalystAgentName = 'Cost Analyst';
export const costAnalystDefaultEnabledTools = ['read_web_page_structure', 'web_search'];

export function isSystemOperatorAgent(agentId: string, defaultAgentId: string): boolean {
  return agentId === defaultAgentId || agentId === costAnalystAgentId;
}
