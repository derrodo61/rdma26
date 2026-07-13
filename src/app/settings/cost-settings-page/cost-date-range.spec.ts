import { describe, expect, it } from 'vitest';

import {
  defaultCustomCostDateRange,
  localDateToIso,
  resolveCostDateRange,
} from './cost-date-range';

describe('defaultCustomCostDateRange', () => {
  it('uses today from midnight through the current minute in the configured time zone', () => {
    expect(
      defaultCustomCostDateRange('Europe/Berlin', new Date('2026-07-13T08:07:45.000Z')),
    ).toEqual({
      from: '2026-07-13',
      to: '2026-07-13',
    });
  });
});

describe('localDateToIso', () => {
  it('converts a local date to its complete UTC range', () => {
    expect(localDateToIso('2026-07-13', 'Europe/Berlin', 'start')).toBe('2026-07-12T22:00:00.000Z');
    expect(localDateToIso('2026-07-13', 'Europe/Berlin', 'end')).toBe('2026-07-13T21:59:59.999Z');
  });

  it('omits empty and invalid values', () => {
    expect(localDateToIso('', 'Europe/Berlin', 'start')).toBeUndefined();
    expect(localDateToIso('not-a-date', 'Europe/Berlin', 'end')).toBeUndefined();
  });
});

describe('resolveCostDateRange', () => {
  const now = new Date('2026-07-15T10:30:00.000Z');

  it('starts today at midnight in the configured time zone', () => {
    expect(resolveCostDateRange({ range: 'today', timeZone: 'Europe/Berlin', now })).toEqual({
      startedFrom: '2026-07-14T22:00:00.000Z',
      startedTo: now.toISOString(),
    });
  });

  it('starts the week on Monday in the configured time zone', () => {
    expect(resolveCostDateRange({ range: 'week', timeZone: 'Europe/Berlin', now })).toEqual({
      startedFrom: '2026-07-12T22:00:00.000Z',
      startedTo: now.toISOString(),
    });
  });

  it('starts the month on its first day in the configured time zone', () => {
    expect(resolveCostDateRange({ range: 'month', timeZone: 'Europe/Berlin', now })).toEqual({
      startedFrom: '2026-06-30T22:00:00.000Z',
      startedTo: now.toISOString(),
    });
  });

  it('uses custom date-time values in the configured time zone', () => {
    expect(
      resolveCostDateRange({
        range: 'custom',
        timeZone: 'Europe/Berlin',
        customFrom: '2026-07-13',
        customTo: '2026-07-15',
      }),
    ).toEqual({
      startedFrom: '2026-07-12T22:00:00.000Z',
      startedTo: '2026-07-15T21:59:59.999Z',
    });
  });
});
