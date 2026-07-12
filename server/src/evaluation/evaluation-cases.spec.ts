import { describe, expect, it } from 'vitest';

import {
  evaluationSuiteVersion,
  listEvaluationCases,
  selectEvaluationCases,
} from './evaluation-cases';

describe('evaluation cases', () => {
  it('defines a versioned stable set covering the product categories', () => {
    const definitions = listEvaluationCases();

    expect(evaluationSuiteVersion).toMatch(/^\d{4}-\d{2}-\d{2}-v\d+$/);
    expect(new Set(definitions.map((definition) => definition.id)).size).toBe(definitions.length);
    expect(new Set(definitions.map((definition) => definition.category))).toEqual(
      new Set([
        'direct',
        'research',
        'calculation',
        'planning',
        'uncertainty',
        'memory',
        'conversation',
      ]),
    );
  });

  it('selects a named suite or explicit case ids', () => {
    expect(selectEvaluationCases('smoke').map((definition) => definition.id)).toEqual([
      'direct-known-fact',
      'deterministic-calculation',
      'explicit-uncertainty',
      'thread-follow-up',
    ]);
    expect(selectEvaluationCases('core', ['agent-local-memory-recall'])).toHaveLength(1);
    expect(() => selectEvaluationCases('core', ['missing-case'])).toThrow(
      'Unknown evaluation case: missing-case.',
    );
  });
});
