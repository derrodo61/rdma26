import { z, type ZodType } from 'zod';

interface RouteDocsOptions {
  readonly tags: readonly string[];
  readonly summary: string;
  readonly params?: ZodType;
  readonly querystring?: ZodType;
  readonly body?: ZodType;
}

export function routeDocs(options: RouteDocsOptions) {
  const schema: Record<string, unknown> = {
    tags: [...options.tags],
    summary: options.summary,
  };

  if (options.params) {
    schema['params'] = zodJsonSchema(options.params);
  }

  if (options.querystring) {
    schema['querystring'] = zodJsonSchema(options.querystring);
  }

  if (options.body) {
    schema['body'] = zodJsonSchema(options.body);
  }

  return {
    schema,
  };
}

function zodJsonSchema(schema: ZodType): unknown {
  return removeJsonSchemaDialect(z.toJSONSchema(schema));
}

function removeJsonSchemaDialect(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => removeJsonSchemaDialect(item));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$schema')
      .map(([key, item]) => [key, removeJsonSchemaDialect(item)]),
  );
}
