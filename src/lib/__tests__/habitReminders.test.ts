import * as Notifications from 'expo-notifications';

import {
  cancelHabitReminder,
  computeReminderTrigger,
  DEFAULT_REMINDER_HOUR,
  reconcileHabitReminders,
  reminderIdentifier,
  scheduleHabitReminder,
} from '../habitReminders';
import { Habit } from '../../types';

// expo-notifications resolves to the root __mocks__ automatic mock: no real
// OS scheduling happens here, and the scheduled list is steered per test.
const mockedSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockedCancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const mockedGetAllScheduled = Notifications.getAllScheduledNotificationsAsync as jest.Mock;

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
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

// Local-time reference moments on 2026-07-05.
const MORNING = new Date(2026, 6, 5, 10, 0, 0);
const EVENING = new Date(2026, 6, 5, 21, 0, 0);

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetAllScheduled.mockResolvedValue([]);
});

describe('computeReminderTrigger', () => {
  it('uses a repeating DAILY 20:00 trigger while today is incomplete', () => {
    expect(computeReminderTrigger(makeHabit(), [], MORNING)).toEqual({
      type: 'daily',
      hour: DEFAULT_REMINDER_HOUR,
      minute: 0,
    });
  });

  it('swaps to a one-shot for tomorrow when completed before the reminder time', () => {
    // Completing at 10:00 must suppress TODAY's 20:00 occurrence, which a
    // repeating trigger cannot do — hence the one-shot for tomorrow.
    expect(computeReminderTrigger(makeHabit(), ['2026-07-05'], MORNING)).toEqual({
      type: 'date',
      date: new Date(2026, 6, 6, DEFAULT_REMINDER_HOUR, 0, 0),
    });
  });

  it('rolls the one-shot across a month boundary correctly', () => {
    const endOfMonth = new Date(2026, 6, 31, 10, 0, 0);
    expect(computeReminderTrigger(makeHabit(), ['2026-07-31'], endOfMonth)).toEqual({
      type: 'date',
      date: new Date(2026, 7, 1, DEFAULT_REMINDER_HOUR, 0, 0),
    });
  });

  it('keeps the repeating trigger when completed AFTER the reminder already fired', () => {
    // 21:00 completion: today's occurrence is in the past, and the repeating
    // trigger's next fire is tomorrow — nothing to suppress.
    expect(computeReminderTrigger(makeHabit(), ['2026-07-05'], EVENING)).toEqual({
      type: 'daily',
      hour: DEFAULT_REMINDER_HOUR,
      minute: 0,
    });
  });

  it('ignores completions on other days', () => {
    expect(computeReminderTrigger(makeHabit(), ['2026-07-04'], MORNING)).toEqual(
      expect.objectContaining({ type: 'daily' }),
    );
  });

  it('never produces a trigger for weekly habits (documented Phase 5 scope)', () => {
    expect(
      computeReminderTrigger(
        makeHabit({ frequency: 'weekly', target_days_per_week: 3 }),
        [],
        MORNING,
      ),
    ).toBeNull();
  });

  it('never produces a trigger for soft-deleted habits', () => {
    expect(
      computeReminderTrigger(makeHabit({ deleted_at: '2026-07-01T00:00:00.000Z' }), [], MORNING),
    ).toBeNull();
  });
});

describe('scheduleHabitReminder', () => {
  it('schedules under the deterministic per-habit identifier with the habit in the content', async () => {
    await scheduleHabitReminder(makeHabit(), [], MORNING);

    expect(mockedSchedule).toHaveBeenCalledWith({
      identifier: 'habit-reminder-habit-1',
      content: expect.objectContaining({
        title: expect.stringContaining('Read'),
        data: { habit_id: 'habit-1' },
      }),
      trigger: { type: 'daily', hour: DEFAULT_REMINDER_HOUR, minute: 0 },
    });
  });

  it('is idempotent: rescheduling reuses the SAME identifier, so the OS replaces instead of duplicating', async () => {
    // The identifier is the whole idempotency guard — if it ever contained a
    // random component, each reschedule would pile up one more pending
    // reminder for the same habit. This test fails if that guard is broken.
    await scheduleHabitReminder(makeHabit(), [], MORNING);
    await scheduleHabitReminder(makeHabit(), [], MORNING);
    await scheduleHabitReminder(makeHabit(), ['2026-07-05'], MORNING);

    const identifiers = mockedSchedule.mock.calls.map(
      ([request]: [{ identifier: string }]) => request.identifier,
    );
    expect(identifiers).toEqual([
      'habit-reminder-habit-1',
      'habit-reminder-habit-1',
      'habit-reminder-habit-1',
    ]);
    expect(new Set(identifiers).size).toBe(1);
  });

  it('cancels the moment the habit is completed before reminder time — today must not fire', async () => {
    await scheduleHabitReminder(makeHabit(), ['2026-07-05'], MORNING);

    // The replacement request fires tomorrow, never later today.
    const [request] = mockedSchedule.mock.calls[0] as [{ trigger: { type: string; date: Date } }];
    expect(request.trigger.type).toBe('date');
    expect(request.trigger.date.getTime()).toBeGreaterThan(
      new Date(2026, 6, 5, 23, 59, 59).getTime(),
    );
  });

  it('cancels instead of scheduling for weekly habits', async () => {
    await scheduleHabitReminder(makeHabit({ frequency: 'weekly' }), [], MORNING);

    expect(mockedSchedule).not.toHaveBeenCalled();
    expect(mockedCancel).toHaveBeenCalledWith('habit-reminder-habit-1');
  });

  it('cancels instead of scheduling for soft-deleted habits', async () => {
    await scheduleHabitReminder(makeHabit({ deleted_at: '2026-07-01T00:00:00.000Z' }), [], MORNING);

    expect(mockedSchedule).not.toHaveBeenCalled();
    expect(mockedCancel).toHaveBeenCalledWith('habit-reminder-habit-1');
  });
});

describe('cancelHabitReminder', () => {
  it('cancels the deterministic identifier', async () => {
    await cancelHabitReminder('habit-9');

    expect(mockedCancel).toHaveBeenCalledWith(reminderIdentifier('habit-9'));
  });
});

describe('reconcileHabitReminders', () => {
  it('schedules every active daily habit and nothing else', async () => {
    const habits = [
      makeHabit(),
      makeHabit({ id: 'habit-weekly', frequency: 'weekly' }),
      makeHabit({ id: 'habit-deleted', deleted_at: '2026-07-01T00:00:00.000Z' }),
    ];

    await reconcileHabitReminders(habits, {}, MORNING);

    const identifiers = mockedSchedule.mock.calls.map(
      ([request]: [{ identifier: string }]) => request.identifier,
    );
    expect(identifiers).toEqual(['habit-reminder-habit-1']);
  });

  it('cancels stale reminders for habits deleted or switched to weekly while the app was closed', async () => {
    // The OS still holds reminders scheduled in a previous run: one for a
    // habit that a sync-while-closed removed, one for a habit that another
    // device switched to weekly.
    mockedGetAllScheduled.mockResolvedValue([
      { identifier: 'habit-reminder-habit-1' },
      { identifier: 'habit-reminder-habit-gone' },
      { identifier: 'habit-reminder-habit-now-weekly' },
    ]);
    const habits = [makeHabit(), makeHabit({ id: 'habit-now-weekly', frequency: 'weekly' })];

    await reconcileHabitReminders(habits, { 'habit-1': [] }, MORNING);

    const canceled = mockedCancel.mock.calls.map(([identifier]: [string]) => identifier);
    expect(canceled).toEqual(
      expect.arrayContaining(['habit-reminder-habit-gone', 'habit-reminder-habit-now-weekly']),
    );
    expect(canceled).not.toContain('habit-reminder-habit-1');
  });

  it('never touches notifications that are not ours', async () => {
    mockedGetAllScheduled.mockResolvedValue([{ identifier: 'some-other-feature' }]);

    await reconcileHabitReminders([], {}, MORNING);

    expect(mockedCancel).not.toHaveBeenCalled();
  });

  it('is idempotent across repeated runs — same identifiers, no accumulation', async () => {
    const habits = [makeHabit(), makeHabit({ id: 'habit-2', name: 'Run' })];

    await reconcileHabitReminders(habits, {}, MORNING);
    await reconcileHabitReminders(habits, {}, MORNING);

    const identifiers = mockedSchedule.mock.calls.map(
      ([request]: [{ identifier: string }]) => request.identifier,
    );
    // Two runs re-issue the same two identifiers; replacement semantics mean
    // the OS ends up with exactly two pending reminders, not four.
    expect(identifiers).toEqual([
      'habit-reminder-habit-1',
      'habit-reminder-habit-2',
      'habit-reminder-habit-1',
      'habit-reminder-habit-2',
    ]);
  });

  it('respects completion state: a habit completed this morning gets the tomorrow one-shot', async () => {
    await reconcileHabitReminders([makeHabit()], { 'habit-1': ['2026-07-05'] }, MORNING);

    const [request] = mockedSchedule.mock.calls[0] as [{ trigger: { type: string } }];
    expect(request.trigger.type).toBe('date');
  });
});
