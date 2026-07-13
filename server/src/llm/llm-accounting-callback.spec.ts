import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import { summarizeChatContext } from './llm-accounting-callback';

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
