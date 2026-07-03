import { detectStreakActivity, habitCreatedEvent } from '../activityEvents';
import { Habit } from '../../types';

const TODAY = '2026-07-03';

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    user_id: 'user-1',
    name: 'Read',
    description: null,
    icon: '📚',
    color: '#10b981',
    frequency: 'daily',
    target_days_per_week: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function detect(input: {
  habit?: Habit;
  date?: string;
  completed?: boolean;
  before: string[];
  after: string[];
}) {
  return detectStreakActivity({
    habit: makeHabit(),
    date: TODAY,
    completed: true,
    today: TODAY,
    ...input,
  });
}

describe('detectStreakActivity', () => {
  it('emits streak_continued for a first-ever completion', () => {
    const events = detect({ before: [], after: [TODAY] });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'streak_continued',
        payload: expect.objectContaining({ current_streak: 1, habit_name: 'Read' }),
      }),
    ]);
  });

  it('emits streak_continued with the new length when a streak extends', () => {
    const events = detect({
      before: ['2026-07-01', '2026-07-02'],
      after: ['2026-07-01', '2026-07-02', TODAY],
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'streak_continued',
        payload: expect.objectContaining({ current_streak: 3 }),
      }),
    ]);
  });

  it('emits nothing when a completion is unchecked', () => {
    const events = detect({
      completed: false,
      before: ['2026-07-02', TODAY],
      after: ['2026-07-02'],
    });

    expect(events).toEqual([]);
  });

  it('emits streak_broken plus the fresh streak_continued after a gap', () => {
    // A 3-day run ended June 29; June 30 through July 2 were missed, and the
    // July 3 check-in is the first to observe the gap.
    const before = ['2026-06-27', '2026-06-28', '2026-06-29'];
    const events = detect({ before, after: [...before, TODAY] });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'streak_broken',
        payload: expect.objectContaining({ previous_streak: 3 }),
      }),
      expect.objectContaining({
        type: 'streak_continued',
        payload: expect.objectContaining({ current_streak: 1 }),
      }),
    ]);
  });

  it('lets streaks below the threshold break silently', () => {
    const before = ['2026-06-28', '2026-06-29'];
    const events = detect({ before, after: [...before, TODAY] });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'streak_continued',
        payload: expect.objectContaining({ current_streak: 1 }),
      }),
    ]);
  });

  it('never emits streak_broken for a backfilled past date', () => {
    // Yesterday is backfilled after a long-ended run: the current streak is
    // repaired/restarted, but only a check-in for today observes a gap.
    const before = ['2026-06-25', '2026-06-26', '2026-06-27'];
    const yesterday = '2026-07-02';
    const events = detect({ date: yesterday, before, after: [...before, yesterday] });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'streak_continued',
        payload: expect.objectContaining({ current_streak: 1 }),
      }),
    ]);
  });

  it('handles weekly habits in whole missed weeks', () => {
    // Weekly habit, target 1: met the weeks of June 1, 8, and 15, then missed
    // the week of June 22 entirely; today (July 3) is in the week of June 29.
    const habit = makeHabit({ frequency: 'weekly', target_days_per_week: 1 });
    const before = ['2026-06-01', '2026-06-08', '2026-06-15'];
    const events = detect({ habit, before, after: [...before, TODAY] });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'streak_broken',
        payload: expect.objectContaining({ previous_streak: 3, frequency: 'weekly' }),
      }),
      expect.objectContaining({
        type: 'streak_continued',
        payload: expect.objectContaining({ current_streak: 1 }),
      }),
    ]);
  });
});

describe('habitCreatedEvent', () => {
  it('carries the habit id, name, and icon', () => {
    expect(habitCreatedEvent(makeHabit())).toEqual({
      type: 'habit_created',
      payload: { habit_id: 'habit-1', habit_name: 'Read', habit_icon: '📚' },
    });
  });
});
