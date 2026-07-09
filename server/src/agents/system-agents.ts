export const costAnalystAgentId = 'cost-analyst';
export const costAnalystAgentName = 'Cost Analyst';

export function isSystemOperatorAgent(agentId: string, defaultAgentId: string): boolean {
  return agentId === defaultAgentId || agentId === costAnalystAgentId;
}
