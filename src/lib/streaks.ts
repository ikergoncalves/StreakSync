// Pure, timezone-safe streak calculation.
//
// Every date in this module is a local-calendar YYYY-MM-DD string, matching
// the Postgres `date` column habit_completions.completed_on. Calendar math
// converts those strings to whole-day numbers via Date.UTC, which is pure
// arithmetic on the string's own fields — the device timezone never leaks in.
// Only todayLocalISO touches the real clock, and it reads local date parts,
// so streaks stay correct across midnight for non-UTC users (e.g. UTC-3).

import { Habit } from '../types';

const MS_PER_DAY = 86_400_000;

export interface Streak {
  /** Consecutive periods (days or weeks) ending now; 0 when broken. */
  current: number;
  /** Best run ever. */
  longest: number;
}

const NO_STREAK: Streak = { current: 0, longest: 0 };

/** Today's date in the device timezone as YYYY-MM-DD. */
export function todayLocalISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Whole days since 1970-01-01 for a YYYY-MM-DD string. */
function toDayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromDayNumber(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Adds days (may be negative) to a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

// Day 0 (1970-01-01) was a Thursday; shifting by 3 makes the week index
// increment on Mondays, giving Monday–Sunday weeks.
function weekIndexOf(dayNumber: number): number {
  return Math.floor((dayNumber + 3) / 7);
}

/** Monday of the week containing the given date (weeks run Monday–Sunday). */
export function startOfWeek(date: string): string {
  return fromDayNumber(weekIndexOf(toDayNumber(date)) * 7 - 3);
}

/** Deduped ascending day numbers, ignoring dates after `today`. */
function sortedDayNumbers(completedDates: string[], today: string): number[] {
  const todayNumber = toDayNumber(today);
  const unique = new Set<number>();
  for (const date of completedDates) {
    const dayNumber = toDayNumber(date);
    if (dayNumber <= todayNumber) {
      unique.add(dayNumber);
    }
  }
  return [...unique].sort((a, b) => a - b);
}

/** Longest run of consecutive values in an ascending, deduped array. */
function longestConsecutiveRun(values: number[]): number {
  let longest = values.length > 0 ? 1 : 0;
  let run = 1;
  for (let i = 1; i < values.length; i += 1) {
    run = values[i] === values[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) {
      longest = run;
    }
  }
  return longest;
}

/**
 * Run of consecutive values ending at the last element, provided the last
 * element is at least `minLast`; 0 otherwise. Used for the "current" side of
 * both streak flavors, where a run must reach the current (or previous)
 * period to still be alive.
 */
function currentConsecutiveRun(values: number[], minLast: number): number {
  if (values.length === 0 || values[values.length - 1] < minLast) {
    return 0;
  }
  let run = 1;
  for (let i = values.length - 2; i >= 0; i -= 1) {
    if (values[i] !== values[i + 1] - 1) {
      break;
    }
    run += 1;
  }
  return run;
}

/**
 * Streaks for a daily habit. The current streak counts consecutive days
 * ending at `today` or yesterday — a missing today does not break the streak
 * until the day is over.
 */
export function computeStreak(completedDates: string[], today: string): Streak {
  const days = sortedDayNumbers(completedDates, today);
  return {
    current: currentConsecutiveRun(days, toDayNumber(today) - 1),
    longest: longestConsecutiveRun(days),
  };
}

/**
 * Streaks for a weekly habit: consecutive Monday–Sunday weeks with at least
 * `targetDaysPerWeek` distinct completed days. Mirroring the daily rule, the
 * in-progress week counts once its target is met but does not break the
 * streak while it is still unfinished.
 */
export function computeWeeklyStreak(
  completedDates: string[],
  today: string,
  targetDaysPerWeek: number,
): Streak {
  const target = Math.min(Math.max(Math.trunc(targetDaysPerWeek), 1), 7);

  const daysPerWeek = new Map<number, number>();
  for (const day of sortedDayNumbers(completedDates, today)) {
    const week = weekIndexOf(day);
    daysPerWeek.set(week, (daysPerWeek.get(week) ?? 0) + 1);
  }
  const metWeeks = [...daysPerWeek.entries()]
    .filter(([, count]) => count >= target)
    .map(([week]) => week)
    .sort((a, b) => a - b);

  return {
    current: currentConsecutiveRun(metWeeks, weekIndexOf(toDayNumber(today)) - 1),
    longest: longestConsecutiveRun(metWeeks),
  };
}

/** Dispatches to the daily or weekly calculation based on the habit's settings. */
export function computeHabitStreak(
  habit: Pick<Habit, 'frequency' | 'target_days_per_week'>,
  completedDates: string[],
  today: string,
): Streak {
  if (completedDates.length === 0) {
    return NO_STREAK;
  }
  if (habit.frequency === 'weekly') {
    return computeWeeklyStreak(completedDates, today, habit.target_days_per_week ?? 1);
  }
  return computeStreak(completedDates, today);
}
