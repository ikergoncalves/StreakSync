import {
  addDays,
  computeHabitStreak,
  computeStreak,
  computeWeeklyStreak,
  startOfWeek,
  todayLocalISO,
} from '../streaks';

// Calendar anchors used across the suite (2026-07-03 is a Friday; its
// Monday–Sunday week runs 2026-06-29 → 2026-07-05).
const FRIDAY = '2026-07-03';

describe('todayLocalISO', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('formats the local date as YYYY-MM-DD', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
    expect(todayLocalISO()).toBe('2026-07-03');
  });

  it('pads single-digit months and days', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 0, 5, 8, 0, 0));
    expect(todayLocalISO()).toBe('2026-01-05');
  });

  it('stays on the local calendar day just before midnight', () => {
    // 23:30 local: a UTC-based formatter would already report the next day
    // for users west of Greenwich (this app targets UTC-3).
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 3, 23, 30, 0));
    expect(todayLocalISO()).toBe('2026-07-03');
  });
});

describe('addDays', () => {
  it('adds within a month', () => {
    expect(addDays('2026-07-03', 1)).toBe('2026-07-04');
  });

  it('crosses month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses year boundaries backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('startOfWeek', () => {
  it('returns the Monday of a mid-week date', () => {
    expect(startOfWeek(FRIDAY)).toBe('2026-06-29');
  });

  it('returns the same date for a Monday', () => {
    expect(startOfWeek('2026-06-29')).toBe('2026-06-29');
  });

  it('keeps Sunday in the week started by the previous Monday', () => {
    expect(startOfWeek('2026-07-05')).toBe('2026-06-29');
  });
});

describe('computeStreak (daily)', () => {
  it('returns zeros for an empty history', () => {
    expect(computeStreak([], FRIDAY)).toEqual({ current: 0, longest: 0 });
  });

  it('counts a single completion today', () => {
    expect(computeStreak([FRIDAY], FRIDAY)).toEqual({ current: 1, longest: 1 });
  });

  it('keeps the streak alive when today is not yet completed', () => {
    // Done yesterday but not today: the day is not over, so current holds.
    expect(computeStreak(['2026-07-02'], FRIDAY)).toEqual({ current: 1, longest: 1 });
  });

  it('breaks the current streak when the last completion is two days old', () => {
    expect(computeStreak(['2026-07-01'], FRIDAY)).toEqual({ current: 0, longest: 1 });
  });

  it('counts a consecutive run ending today', () => {
    const dates = ['2026-06-30', '2026-07-01', '2026-07-02', FRIDAY];
    expect(computeStreak(dates, FRIDAY)).toEqual({ current: 4, longest: 4 });
  });

  it('counts a consecutive run ending yesterday as current', () => {
    const dates = ['2026-06-30', '2026-07-01', '2026-07-02'];
    expect(computeStreak(dates, FRIDAY)).toEqual({ current: 3, longest: 3 });
  });

  it('restarts the current streak after a gap', () => {
    const dates = ['2026-06-25', '2026-06-26', '2026-06-28', FRIDAY];
    expect(computeStreak(dates, FRIDAY)).toEqual({ current: 1, longest: 2 });
  });

  it('keeps the longest streak from an older, longer run', () => {
    const dates = [
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-07-02',
      FRIDAY,
    ];
    expect(computeStreak(dates, FRIDAY)).toEqual({ current: 2, longest: 5 });
  });

  it('spans month boundaries', () => {
    expect(computeStreak(['2026-01-31', '2026-02-01'], '2026-02-01')).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('spans year boundaries', () => {
    expect(computeStreak(['2025-12-31', '2026-01-01'], '2026-01-01')).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('spans a leap-year February', () => {
    const dates = ['2024-02-28', '2024-02-29', '2024-03-01'];
    expect(computeStreak(dates, '2024-03-01')).toEqual({ current: 3, longest: 3 });
  });

  it('does not treat Feb 28 → Mar 1 as consecutive in a leap year', () => {
    expect(computeStreak(['2024-02-28', '2024-03-01'], '2024-03-01')).toEqual({
      current: 1,
      longest: 1,
    });
  });

  it('ignores duplicate completions of the same day', () => {
    expect(computeStreak([FRIDAY, FRIDAY, '2026-07-02', '2026-07-02'], FRIDAY)).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('accepts unsorted input', () => {
    const dates = [FRIDAY, '2026-07-01', '2026-07-02'];
    expect(computeStreak(dates, FRIDAY)).toEqual({ current: 3, longest: 3 });
  });

  it('ignores dates after today', () => {
    expect(computeStreak([FRIDAY, '2026-07-04', '2026-07-05'], FRIDAY)).toEqual({
      current: 1,
      longest: 1,
    });
  });
});

describe('computeWeeklyStreak', () => {
  it('returns zeros for an empty history', () => {
    expect(computeWeeklyStreak([], FRIDAY, 3)).toEqual({ current: 0, longest: 0 });
  });

  it('counts the in-progress week once its target is met', () => {
    const dates = ['2026-06-29', '2026-07-01'];
    expect(computeWeeklyStreak(dates, FRIDAY, 2)).toEqual({ current: 1, longest: 1 });
  });

  it('does not count the in-progress week below target, but does not break either', () => {
    // Last week (06-22 → 06-28) met the target of 3; this week has 1 so far.
    const dates = ['2026-06-22', '2026-06-24', '2026-06-26', '2026-07-01'];
    expect(computeWeeklyStreak(dates, FRIDAY, 3)).toEqual({ current: 1, longest: 1 });
  });

  it('counts consecutive weeks ending this week', () => {
    const dates = [
      // Week of 06-15: 2 days.
      '2026-06-15',
      '2026-06-17',
      // Week of 06-22: 2 days.
      '2026-06-23',
      '2026-06-28',
      // Week of 06-29 (current): 2 days.
      '2026-06-29',
      '2026-07-02',
    ];
    expect(computeWeeklyStreak(dates, FRIDAY, 2)).toEqual({ current: 3, longest: 3 });
  });

  it('breaks the current streak when a full week missed the target', () => {
    const dates = [
      // Week of 06-15 met the target...
      '2026-06-15',
      '2026-06-16',
      // ...week of 06-22 only had 1 of 2, week of 06-29 (current) met it.
      '2026-06-24',
      '2026-06-29',
      '2026-06-30',
    ];
    expect(computeWeeklyStreak(dates, FRIDAY, 2)).toEqual({ current: 1, longest: 1 });
  });

  it('returns zero current when both this week and last week are unmet', () => {
    const dates = ['2026-06-18', '2026-06-19'];
    expect(computeWeeklyStreak(dates, FRIDAY, 2)).toEqual({ current: 0, longest: 1 });
  });

  it('tracks longest across a gap week', () => {
    const dates = [
      // Weeks of 05-25, 06-01, 06-08 all met (target 1)...
      '2026-05-27',
      '2026-06-03',
      '2026-06-10',
      // ...week of 06-15 missed, week of 06-22 met.
      '2026-06-23',
    ];
    expect(computeWeeklyStreak(dates, FRIDAY, 1)).toEqual({ current: 1, longest: 3 });
  });

  it('splits Sunday and Monday into different weeks', () => {
    // Sunday 06-28 closes one week; Monday 06-29 opens the next.
    const dates = ['2026-06-28', '2026-06-29'];
    expect(computeWeeklyStreak(dates, FRIDAY, 1)).toEqual({ current: 2, longest: 2 });
  });

  it('keeps Monday and the following Sunday in the same week', () => {
    const dates = ['2026-06-29', '2026-07-05'];
    expect(computeWeeklyStreak(dates, '2026-07-05', 2)).toEqual({ current: 1, longest: 1 });
  });

  it('spans year boundaries', () => {
    const dates = [
      // Week of 2025-12-29 (spills into January): 2 days.
      '2025-12-30',
      '2026-01-02',
      // Week of 2026-01-05: 2 days.
      '2026-01-05',
      '2026-01-07',
    ];
    expect(computeWeeklyStreak(dates, '2026-01-07', 2)).toEqual({ current: 2, longest: 2 });
  });

  it('requires all seven days when the target is 7', () => {
    const sixDays = ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', FRIDAY, '2026-07-04'];
    expect(computeWeeklyStreak(sixDays, '2026-07-05', 7)).toEqual({ current: 0, longest: 0 });
    expect(computeWeeklyStreak([...sixDays, '2026-07-05'], '2026-07-05', 7)).toEqual({
      current: 1,
      longest: 1,
    });
  });

  it('ignores duplicate completions when counting days in a week', () => {
    const dates = ['2026-06-29', '2026-06-29', '2026-07-01'];
    expect(computeWeeklyStreak(dates, FRIDAY, 3)).toEqual({ current: 0, longest: 0 });
  });

  it('ignores dates after today', () => {
    const dates = ['2026-07-04', '2026-07-05'];
    expect(computeWeeklyStreak(dates, FRIDAY, 1)).toEqual({ current: 0, longest: 0 });
  });
});

describe('computeHabitStreak', () => {
  const today = FRIDAY;

  it('routes daily habits to the daily calculation', () => {
    const habit = { frequency: 'daily', target_days_per_week: null } as const;
    expect(computeHabitStreak(habit, ['2026-07-02', FRIDAY], today)).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('routes weekly habits to the weekly calculation', () => {
    const habit = { frequency: 'weekly', target_days_per_week: 2 } as const;
    expect(computeHabitStreak(habit, ['2026-06-29', '2026-07-01'], today)).toEqual({
      current: 1,
      longest: 1,
    });
  });

  it('falls back to a target of 1 when a weekly habit has none', () => {
    const habit = { frequency: 'weekly', target_days_per_week: null } as const;
    expect(computeHabitStreak(habit, ['2026-07-01'], today)).toEqual({ current: 1, longest: 1 });
  });

  it('returns zeros for an empty history', () => {
    const habit = { frequency: 'daily', target_days_per_week: null } as const;
    expect(computeHabitStreak(habit, [], today)).toEqual({ current: 0, longest: 0 });
  });
});
