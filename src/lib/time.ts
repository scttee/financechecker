/**
 * Time.
 *
 * Everything in this app happens in Australia/Sydney. Pay cycles, "days until
 * payday", and "spent this week" are all wrong by a day if you reason in UTC
 * around a Sydney midnight, so the timezone is explicit at every boundary.
 *
 * Timestamps are stored as UTC instants (Prisma DateTime). Only presentation
 * and day-boundary maths go through the zone.
 */

import { TZDate } from '@date-fns/tz';
import {
  differenceInCalendarDays,
  differenceInMinutes,
  addDays,
  addMonths,
  format,
  startOfDay,
  endOfDay,
  isAfter,
  isBefore,
} from 'date-fns';

export const DEFAULT_TIMEZONE = 'Australia/Sydney';

export function inZone(date: Date, timeZone: string = DEFAULT_TIMEZONE): TZDate {
  return new TZDate(date, timeZone);
}

/** Local midnight at the start of the day containing `date`, as a UTC instant. */
export function zonedStartOfDay(date: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  return new Date(startOfDay(inZone(date, timeZone)).getTime());
}

/** The last instant of the local day containing `date`. */
export function zonedEndOfDay(date: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  return new Date(endOfDay(inZone(date, timeZone)).getTime());
}

/**
 * Whole days between two instants, counted by local calendar date. Monday
 * 11pm to Tuesday 1am is 1 day, not 0, which is what "days until payday"
 * should mean.
 */
export function calendarDaysBetween(
  from: Date,
  to: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  return differenceInCalendarDays(inZone(to, timeZone), inZone(from, timeZone));
}

export function minutesBetween(from: Date, to: Date): number {
  return differenceInMinutes(to, from);
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(addDays(date, days).getTime());
}

export function addMonthsUtc(date: Date, months: number): Date {
  return new Date(addMonths(date, months).getTime());
}

export function addHoursUtc(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

// --- Formatting ------------------------------------------------------------

export function formatDate(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(inZone(date, timeZone), 'd MMM yyyy');
}

/** "Tue 23 Sep" — the form used across the dashboard. */
export function formatDayShort(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(inZone(date, timeZone), 'EEE d MMM');
}

export function formatTime(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(inZone(date, timeZone), 'h:mma').toLowerCase();
}

export function formatDateTime(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return `${formatDayShort(date, timeZone)}, ${formatTime(date, timeZone)}`;
}

/**
 * "3m ago", "2h ago", or a short date once it is more than a day old — how
 * stale a "last synced" figure is, at a glance.
 */
export function formatRelative(date: Date, now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const minutes = Math.max(0, minutesBetween(date, now));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDayShort(date, timeZone);
}

/** RFC-3339 with offset, the format Up's filter[since] / filter[until] want. */
export function toRfc3339(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(inZone(date, timeZone), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** ISO date only, for <input type="date"> round-tripping. */
export function toDateInputValue(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(inZone(date, timeZone), 'yyyy-MM-dd');
}

// --- Ranges ----------------------------------------------------------------

export interface DateRange {
  start: Date;
  /** Exclusive. */
  end: Date;
}

export function isWithin(date: Date, range: DateRange): boolean {
  return !isBefore(date, range.start) && isBefore(date, range.end);
}

export function clampToRange(date: Date, range: DateRange): Date {
  if (isBefore(date, range.start)) return range.start;
  if (isAfter(date, range.end)) return range.end;
  return date;
}

/**
 * How far through a range we are, 0-100. Clamped, so a range that has ended
 * reads 100 rather than 137.
 */
export function elapsedPercent(range: DateRange, now: Date): number {
  const span = range.end.getTime() - range.start.getTime();
  if (span <= 0) return 100;
  const done = now.getTime() - range.start.getTime();
  const pct = Math.round((done / span) * 100);
  return Math.min(100, Math.max(0, pct));
}

/**
 * Whole days remaining in a range, counted by local calendar date and floored
 * at 0. The day the range ends counts as 0 days remaining.
 */
export function daysRemaining(
  range: DateRange,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  return Math.max(0, calendarDaysBetween(now, range.end, timeZone));
}
