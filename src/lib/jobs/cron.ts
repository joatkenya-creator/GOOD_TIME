import 'server-only';

/**
 * A five-field cron parser and next-occurrence calculator.
 *
 * Hand-written rather than pulled from a dependency, because the whole of what
 * this system needs is "does this minute match, and when is the next one" — the
 * grammar below is under a hundred lines and has no transitive dependencies to
 * audit. A library earns its place when timezones, DST rules and `@yearly`
 * aliases matter; every schedule here is UTC and expressible in five fields.
 *
 * Supported: `*`, `5`, `1,15`, `1-5`, `star/15`, and ranges with steps.
 * Not supported: `L`, `W`, `#`, names like `MON`. If a schedule ever needs
 * those, that is the moment to reach for a parser, not before.
 */

interface Field {
  min: number;
  max: number;
}

const FIELDS: Field[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week, Sunday = 0
];

/** Expands one field into the set of values it matches. */
function expand(expression: string, field: Field): Set<number> {
  const values = new Set<number>();

  for (const part of expression.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;

    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid step in cron field: ${part}`);
    }

    let start = field.min;
    let end = field.max;

    if (range && range !== '*') {
      const [fromRaw, toRaw] = range.split('-');
      start = Number(fromRaw);
      end = toRaw === undefined ? (stepRaw ? field.max : start) : Number(toRaw);

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Invalid cron range: ${part}`);
      }
      if (start < field.min || end > field.max || start > end) {
        throw new Error(`Cron value out of range: ${part}`);
      }
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }

  return values;
}

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** True when both day fields are restricted — cron ORs them, famously. */
  bothDaysRestricted: boolean;
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`A cron expression needs five fields, got ${parts.length}: "${expression}"`);
  }

  const sets = parts.map((part, index) => expand(part, FIELDS[index]!));

  return {
    minute: sets[0]!,
    hour: sets[1]!,
    dayOfMonth: sets[2]!,
    month: sets[3]!,
    dayOfWeek: sets[4]!,
    // POSIX cron: when both day-of-month and day-of-week are restricted, a
    // match on *either* fires. Getting this wrong is the classic cron bug —
    // "0 0 1 * 1" means the 1st and every Monday, not Mondays that are the 1st.
    bothDaysRestricted: parts[2] !== '*' && parts[4] !== '*',
  };
}

function matches(parsed: ParsedCron, date: Date): boolean {
  const dayOfMonth = parsed.dayOfMonth.has(date.getUTCDate());
  const dayOfWeek = parsed.dayOfWeek.has(date.getUTCDay());

  const dayMatches = parsed.bothDaysRestricted ? dayOfMonth || dayOfWeek : dayOfMonth && dayOfWeek;

  return (
    parsed.minute.has(date.getUTCMinutes()) &&
    parsed.hour.has(date.getUTCHours()) &&
    parsed.month.has(date.getUTCMonth() + 1) &&
    dayMatches
  );
}

/**
 * The next time this expression fires after `from`, in UTC.
 *
 * Walks forward a minute at a time with a hard ceiling. Brute force is
 * defensible here: the loop runs at most a few thousand iterations of integer
 * comparisons, and it is obviously correct, which a closed-form solution
 * covering leap years and month lengths would not be.
 */
export function nextRun(expression: string, from: Date = new Date()): Date | null {
  const parsed = parseCron(expression);

  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  // Four years of minutes covers every schedule expressible in five fields,
  // including 29 February. Beyond that the expression matches nothing.
  const limit = 366 * 4 * 24 * 60;

  for (let step = 0; step < limit; step += 1) {
    if (matches(parsed, cursor)) return new Date(cursor.getTime());
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return null;
}

/** Validates without throwing — for the admin form. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/** Plain-English rendering, so the admin does not make people read cron. */
export function describeCron(expression: string): string {
  const common: Record<string, string> = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Hourly',
    '0 */6 * * *': 'Every 6 hours',
    '0 0 * * *': 'Daily at midnight UTC',
    '0 2 * * *': 'Daily at 02:00 UTC',
    '0 3 * * *': 'Daily at 03:00 UTC',
    '0 4 * * *': 'Daily at 04:00 UTC',
    '0 0 * * 0': 'Weekly on Sunday',
    '0 0 1 * *': 'Monthly on the 1st',
  };

  if (common[expression]) return common[expression];

  const next = nextRun(expression);
  return next ? `Next: ${next.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Never';
}
