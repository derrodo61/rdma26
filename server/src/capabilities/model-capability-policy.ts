import type { RunContextWithheldCapability } from '../../../shared/agent-contracts';
import { resolveModelSelection } from '../llm/model-factory';
import { webSearchCapabilityId } from './capability-registry';

export interface EffectiveCapabilities {
  readonly enabledCapabilityIds: readonly string[];
  readonly withheldCapabilities: readonly RunContextWithheldCapability[];
}

export function resolveEffectiveCapabilities(
  modelSelectionId: string,
  grantedCapabilityIds: readonly string[],
): EffectiveCapabilities {
  const model = resolveModelSelection(modelSelectionId);

  if (
    model.provider !== 'openai-chatgpt' ||
    !grantedCapabilityIds.includes(webSearchCapabilityId)
  ) {
    return {
      enabledCapabilityIds: [...grantedCapabilityIds],
      withheldCapabilities: [],
    };
  }

  return {
    enabledCapabilityIds: grantedCapabilityIds.filter(
      (capabilityId) => capabilityId !== webSearchCapabilityId,
    ),
    withheldCapabilities: [
      {
        id: webSearchCapabilityId,
        reason:
          'OpenAI hosted web search requires an OpenAI API model and was not included in this ChatGPT/Codex run.',
      },
    ],
  };
}
