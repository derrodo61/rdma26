export type CostDateRange = 'today' | 'week' | 'month' | 'custom';

export interface CostDateRangeFilter {
  readonly startedFrom?: string;
  readonly startedTo?: string;
}

export function defaultCustomCostDateRange(
  timeZone: string,
  now = new Date(),
): { readonly from: string; readonly to: string } {
  const localNow = datePartsInTimeZone(now, timeZone);
  const date = `${localNow.year}-${padDatePart(localNow.month)}-${padDatePart(localNow.day)}`;

  return {
    from: date,
    to: date,
  };
}

export function localDateToIso(
  value: string,
  timeZone: string,
  boundary: 'start' | 'end',
): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return undefined;
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));

  if (boundary === 'end') {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  const timestamp = zonedDateTimeToIso(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: 0,
      minute: 0,
    },
    timeZone,
  );

  return boundary === 'end' ? new Date(Date.parse(timestamp) - 1).toISOString() : timestamp;
}

export function resolveCostDateRange(options: {
  readonly range: CostDateRange;
  readonly timeZone: string;
  readonly now?: Date;
  readonly customFrom?: string;
  readonly customTo?: string;
}): CostDateRangeFilter {
  if (options.range === 'custom') {
    return {
      startedFrom: localDateToIso(options.customFrom ?? '', options.timeZone, 'start'),
      startedTo: localDateToIso(options.customTo ?? '', options.timeZone, 'end'),
    };
  }

  const now = options.now ?? new Date();
  const localDate = datePartsInTimeZone(now, options.timeZone);
  const startDate = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day));

  if (options.range === 'week') {
    const daysSinceMonday = (startDate.getUTCDay() + 6) % 7;
    startDate.setUTCDate(startDate.getUTCDate() - daysSinceMonday);
  } else if (options.range === 'month') {
    startDate.setUTCDate(1);
  }

  return {
    startedFrom: zonedDateTimeToIso(
      {
        year: startDate.getUTCFullYear(),
        month: startDate.getUTCMonth() + 1,
        day: startDate.getUTCDate(),
        hour: 0,
        minute: 0,
      },
      options.timeZone,
    ),
    startedTo: now.toISOString(),
  };
}

function datePartsInTimeZone(
  date: Date,
  timeZone: string,
): { readonly year: number; readonly month: number; readonly day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return {
    year: datePart(parts, 'year'),
    month: datePart(parts, 'month'),
    day: datePart(parts, 'day'),
  };
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function zonedDateTimeToIso(
  parts: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
  },
  timeZone: string,
): string {
  const targetUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let candidate = new Date(targetUtc);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = timeZoneOffsetMilliseconds(candidate, timeZone);
    candidate = new Date(targetUtc - offset);
  }

  return candidate.toISOString();
}

function timeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const asUtc = Date.UTC(
    datePart(parts, 'year'),
    datePart(parts, 'month') - 1,
    datePart(parts, 'day'),
    datePart(parts, 'hour'),
    datePart(parts, 'minute'),
    datePart(parts, 'second'),
  );

  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function datePart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;

  if (!value) {
    throw new Error(`Missing ${type} while resolving a date range.`);
  }

  return Number(value);
}
