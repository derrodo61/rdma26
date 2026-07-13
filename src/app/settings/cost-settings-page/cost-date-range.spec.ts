import { describe, expect, it } from 'vitest';

import { localDateTimeToIso, resolveCostDateRange } from './cost-date-range';

describe('localDateTimeToIso', () => {
  it('converts a local date-time value to the equivalent UTC timestamp', () => {
    const value = '2026-07-13T14:30';

    expect(localDateTimeToIso(value, 'Europe/Berlin')).toBe('2026-07-13T12:30:00.000Z');
  });

  it('omits empty and invalid values', () => {
    expect(localDateTimeToIso('', 'Europe/Berlin')).toBeUndefined();
    expect(localDateTimeToIso('not-a-date', 'Europe/Berlin')).toBeUndefined();
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
        customFrom: '2026-07-13T09:15',
        customTo: '2026-07-13T18:45',
      }),
    ).toEqual({
      startedFrom: '2026-07-13T07:15:00.000Z',
      startedTo: '2026-07-13T16:45:00.000Z',
    });
  });
});
