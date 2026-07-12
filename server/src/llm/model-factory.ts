import { ChatOpenAI } from '@langchain/openai';

export function createOpenAiChatModel(
  model: string,
  options: OpenAiChatModelOptions = {},
): ChatOpenAI {
  const apiKey = process.env['OPENAI_API_KEY'];

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required to create an OpenAI chat model.');
  }

  return new ChatOpenAI({
    apiKey,
    model,
    temperature: options.temperature,
  });
}

interface OpenAiChatModelOptions {
  readonly temperature?: number;
}
