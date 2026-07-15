import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { Serialized } from '@langchain/core/load/serializable';
import { describe, expect, it, vi } from 'vitest';

import { LlmAccountingCallbackHandler, summarizeChatContext } from './llm-accounting-callback';
import type { LlmCallStore } from './llm-call-store';

describe('LLM accounting context composition', () => {
  it('records aggregate message and tool-definition sizes without prompt content', () => {
    const composition = summarizeChatContext(
      [
        [
          new SystemMessage('System guidance'),
          new HumanMessage('Current question'),
          new AIMessage('I will inspect a source.'),
          new ToolMessage({ content: 'Bounded tool result', tool_call_id: 'tool-1' }),
        ],
      ],
      {
        invocation_params: {
          tools: [
            { type: 'web_search' },
            { type: 'function', name: 'read_file', description: 'Read a file.' },
          ],
        },
      },
    );

    expect(composition).toMatchObject({
      messageGroupCount: 1,
      messageCount: 4,
      toolDefinitionCount: 2,
      toolDefinitions: [{ name: 'read_file' }, { name: 'web_search' }],
      contentBlocksByType: {},
      messagesByRole: {
        system: { count: 1 },
        human: { count: 1 },
        ai: { count: 1 },
        tool: { count: 1 },
      },
    });
    expect(composition.messageCharacters).toBeGreaterThan(0);
    expect(composition.toolDefinitionCharacters).toBeGreaterThan(0);
    expect(JSON.stringify(composition)).not.toContain('System guidance');
    expect(JSON.stringify(composition)).not.toContain('Current question');
  });
});

describe('LlmAccountingCallbackHandler', () => {
  it('marks aborted LLM errors as cancelled', async () => {
    const abortController = new AbortController();
    const startCall = vi.fn(async () => ({
      id: 'call-1',
    }));
    const finishCall = vi.fn();
    const handler = new LlmAccountingCallbackHandler(
      { startCall, finishCall } as unknown as LlmCallStore,
      {
        runId: 'run-1',
        provider: 'openai',
        model: 'gpt-test',
        purpose: 'chat',
        signal: abortController.signal,
      },
    );

    await handler.handleLLMStart(serializedModel(), ['Hello'], 'provider-run-1');
    abortController.abort();
    await handler.handleLLMError(new Error('aborted'), 'provider-run-1');

    expect(finishCall).toHaveBeenCalledWith('call-1', 'cancelled', undefined, 'aborted');
  });
});

function serializedModel(): Serialized {
  return {
    lc: 1,
    type: 'constructor',
    id: ['test', 'model'],
    kwargs: { model: 'gpt-test' },
  };
}
