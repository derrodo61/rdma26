export const costAnalystAgentId = 'cost-analyst';
export const costAnalystAgentName = 'Cost Analyst';
export const costAnalystDefaultEnabledTools = ['extract_web_content', 'research'];

export function isSystemOperatorAgent(agentId: string, defaultAgentId: string): boolean {
  return agentId === defaultAgentId || agentId === costAnalystAgentId;
}
