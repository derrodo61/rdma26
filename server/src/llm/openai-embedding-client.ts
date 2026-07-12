import OpenAI from 'openai';

import type { LlmCallStore } from './llm-call-store';

export interface EmbeddingAccountingContext {
  readonly runId?: string;
  readonly agentId?: string;
  readonly threadId?: string;
  readonly operation: 'memory_index' | 'memory_query';
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ObservableEmbeddingClient {
  embedDocuments(
    texts: readonly string[],
    context: EmbeddingAccountingContext,
  ): Promise<number[][]>;
  embedQuery(text: string, context: EmbeddingAccountingContext): Promise<number[]>;
}

interface OpenAiEmbeddingApi {
  readonly embeddings: {
    create(request: {
      readonly model: string;
      readonly input: string | readonly string[];
    }): Promise<{
      readonly data: readonly {
        readonly embedding: readonly number[];
        readonly index: number;
      }[];
      readonly model: string;
      readonly usage: {
        readonly prompt_tokens: number;
        readonly total_tokens: number;
      };
    }>;
  };
}

export class AccountingOpenAiEmbeddingClient implements ObservableEmbeddingClient {
  private readonly client: OpenAiEmbeddingApi;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly callStore: LlmCallStore,
    client?: OpenAiEmbeddingApi,
    private readonly batchSize = 512,
  ) {
    this.client = client ?? (new OpenAI({ apiKey }) as OpenAiEmbeddingApi);
  }

  async embedDocuments(
    texts: readonly string[],
    context: EmbeddingAccountingContext,
  ): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      vectors.push(
        ...(await this.createEmbeddings(batch, {
          ...context,
          metadata: {
            ...context.metadata,
            batchOffset: offset,
            batchSize: batch.length,
          },
        })),
      );
    }

    return vectors;
  }

  async embedQuery(text: string, context: EmbeddingAccountingContext): Promise<number[]> {
    const [vector] = await this.createEmbeddings([text], context);

    if (!vector) {
      throw new Error('OpenAI returned no embedding for the memory query.');
    }

    return vector;
  }

  private async createEmbeddings(
    inputs: readonly string[],
    context: EmbeddingAccountingContext,
  ): Promise<number[][]> {
    const call = await this.callStore.startCall({
      runId: context.runId,
      provider: 'openai',
      model: this.model,
      purpose: 'memory_retrieval',
      agentId: context.agentId,
      threadId: context.threadId,
      metadata: {
        requestKind: 'embedding',
        operation: context.operation,
        inputCount: inputs.length,
        ...context.metadata,
      },
    });

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: inputs.map((input) => input.replace(/\n/g, ' ')),
      });
      await this.callStore.finishCall(call.id, 'success', {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: 0,
        totalTokens: response.usage.total_tokens,
      });

      return [...response.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => [...item.embedding]);
    } catch (error) {
      await this.callStore.finishCall(
        call.id,
        'error',
        undefined,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}
