import { deleteDatabaseSync } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';

import { closeLocalDb, getLocalDb, listAllQueueRows, LOCAL_DB_NAME } from '../localDb';
import {
  applyServerCompletion,
  applyServerHabit,
  CompletionTogglePayload,
  completionEntityId,
  getLocalHabit,
  getSyncQueueSummary,
  HabitCreatePayload,
  HabitUpdatePayload,
  hydrateHabitsData,
  localCreateHabit,
  localSoftDeleteHabit,
  localToggleCompletion,
  localUpdateHabit,
  mergeServerData,
} from '../localHabits';
import { computeHabitStreak, addDays, todayLocalISO } from '../streaks';
import { Habit, HabitCompletion } from '../../types';

// Real, distinct UUIDs matter here (queue row ids, habit ids, completion
// ids must never collide); node's implementation stands in for the native one.
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => jest.requireActual<typeof import('crypto')>('crypto').randomUUID()),
}));

const mockedRandomUUID = randomUUID as jest.Mock;

const INPUT = {
  name: 'Read',
  description: null,
  icon: '📚',
  color: '#10b981',
  frequency: 'daily' as const,
  target_days_per_week: null,
};

function makeServerHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-server',
    user_id: 'user-1',
    name: 'Run',
    description: null,
    icon: '🏃',
    color: null,
    frequency: 'daily',
    target_days_per_week: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function makeServerCompletion(overrides: Partial<HabitCompletion> = {}): HabitCompletion {
  return {
    id: 'completion-server',
    habit_id: 'habit-server',
    user_id: 'user-1',
    completed_on: '2026-07-02',
    created_at: '2026-07-02T12:00:00.000Z',
    updated_at: '2026-07-02T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedRandomUUID.mockImplementation(() =>
    jest.requireActual<typeof import('crypto')>('crypto').randomUUID(),
  );
  closeLocalDb();
  deleteDatabaseSync(LOCAL_DB_NAME);
});

describe('localCreateHabit', () => {
  it('writes the habit and its create queue row in the same transaction', () => {
    const habit = localCreateHabit('user-1', INPUT);

    expect(getLocalHabit(habit.id)).toEqual(habit);
    const [row] = listAllQueueRows('user-1');
    expect(row).toMatchObject({
      entity_type: 'habit',
      entity_id: habit.id,
      operation: 'create',
      status: 'pending',
      attempts: 0,
    });
    expect(JSON.parse(row.payload) as HabitCreatePayload).toEqual({ habit });
  });

  it('never writes the habit without its queue row (atomicity)', () => {
    // Force the SECOND insert of the transaction (the queue row) to violate
    // the primary key: both inserts draw from randomUUID, so a constant stub
    // makes the queue row id collide with the habit id... except habit and
    // queue live in different tables. Collide two queue ids instead: seed a
    // queue row with a known id, then make randomUUID return that id.
    localCreateHabit('user-1', INPUT);
    const [seeded] = listAllQueueRows('user-1');
    const habitId = jest.requireActual<typeof import('crypto')>('crypto').randomUUID();
    mockedRandomUUID.mockReturnValueOnce(habitId).mockReturnValueOnce(seeded.id);

    expect(() => localCreateHabit('user-1', INPUT)).toThrow();

    // The habit insert succeeded inside the transaction, but the enqueue
    // failed — the rollback must take the habit with it, or local and remote
    // state could diverge permanently.
    expect(getLocalHabit(habitId)).toBeNull();
    expect(listAllQueueRows('user-1')).toHaveLength(1);
  });
});

describe('localUpdateHabit', () => {
  it('applies the partial edit, bumps updated_at, and queues input plus base timestamp', () => {
    const habit = localCreateHabit('user-1', INPUT);

    const updated = localUpdateHabit('user-1', habit.id, { name: 'Read books', icon: null });

    expect(updated).toMatchObject({ name: 'Read books', icon: null, color: '#10b981' });
    expect(updated!.updated_at >= habit.updated_at).toBe(true);
    const rows = listAllQueueRows('user-1');
    expect(rows).toHaveLength(2);
    const payload = JSON.parse(rows[1].payload) as HabitUpdatePayload;
    expect(payload.input).toEqual({ name: 'Read books', icon: null });
    expect(payload.base_updated_at).toBe(updated!.updated_at);
  });

  it('returns null and queues nothing for an unknown habit', () => {
    expect(localUpdateHabit('user-1', 'missing', { name: 'X' })).toBeNull();
    expect(listAllQueueRows('user-1')).toHaveLength(0);
  });
});

describe('localSoftDeleteHabit', () => {
  it('soft-deletes locally (hydration hides it) and queues the delete', () => {
    const habit = localCreateHabit('user-1', INPUT);
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });

    expect(localSoftDeleteHabit('user-1', habit.id)).toBe(true);

    expect(getLocalHabit(habit.id)!.deleted_at).not.toBeNull();
    const { habits, completions } = hydrateHabitsData('user-1');
    expect(habits).toEqual([]);
    expect(completions).toEqual({});
    expect(listAllQueueRows('user-1').map((row) => row.operation)).toEqual([
      'create',
      'toggle_completion',
      'delete',
    ]);
  });

  it('returns false for an unknown habit', () => {
    expect(localSoftDeleteHabit('user-1', 'missing')).toBe(false);
    expect(listAllQueueRows('user-1')).toHaveLength(0);
  });
});

describe('localToggleCompletion', () => {
  it('inserts the completion and queues the absolute state on first toggle', () => {
    const habit = localCreateHabit('user-1', INPUT);

    const { completed } = localToggleCompletion({
      habitId: habit.id,
      userId: 'user-1',
      date: '2026-07-02',
    });

    expect(completed).toBe(true);
    expect(hydrateHabitsData('user-1').completions[habit.id]).toEqual(['2026-07-02']);
    const row = listAllQueueRows('user-1').find((r) => r.operation === 'toggle_completion')!;
    expect(row.entity_id).toBe(completionEntityId(habit.id, '2026-07-02'));
    expect(JSON.parse(row.payload) as CompletionTogglePayload).toMatchObject({
      habit_id: habit.id,
      completed_on: '2026-07-02',
      completed: true,
    });
  });

  it('collapses repeated toggles of the same habit/date into ONE queue row', () => {
    const habit = localCreateHabit('user-1', INPUT);
    const toggle = () =>
      localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });

    // done -> undone -> done: one logical change by sync time, so exactly one
    // queued mutation reflecting the FINAL state — never three operations.
    toggle();
    const afterFirst = listAllQueueRows('user-1').find(
      (r) => r.operation === 'toggle_completion',
    )!;
    toggle();
    toggle();

    const toggleRows = listAllQueueRows('user-1').filter(
      (r) => r.operation === 'toggle_completion',
    );
    expect(toggleRows).toHaveLength(1);
    // Same row, updated in place (order in the queue is preserved)...
    expect(toggleRows[0].id).toBe(afterFirst.id);
    // ...with the version bumped once per collapse, so an in-flight drain
    // that read version 0 cannot delete this newer state.
    expect(toggleRows[0].version).toBe(2);
    expect(JSON.parse(toggleRows[0].payload) as CompletionTogglePayload).toMatchObject({
      completed: true,
    });
    expect(hydrateHabitsData('user-1').completions[habit.id]).toEqual(['2026-07-02']);
  });

  it('re-arms a failed queue row when the user toggles the same habit/date again', () => {
    const habit = localCreateHabit('user-1', INPUT);
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    const row = listAllQueueRows('user-1').find((r) => r.operation === 'toggle_completion')!;
    getLocalDb().runSync(
      "UPDATE sync_queue SET status = 'failed', attempts = 5, last_error = 'permission denied' WHERE id = ?",
      [row.id],
    );

    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });

    const rearmed = listAllQueueRows('user-1').find((r) => r.id === row.id)!;
    expect(rearmed).toMatchObject({ status: 'pending', attempts: 0, last_error: null });
  });
});

describe('hydrateHabitsData', () => {
  it('scopes to the given user and orders habits by creation time', () => {
    const mine = localCreateHabit('user-1', INPUT);
    const later = localCreateHabit('user-1', { ...INPUT, name: 'Run' });
    const theirs = localCreateHabit('user-2', { ...INPUT, name: 'Peer habit' });
    localToggleCompletion({ habitId: theirs.id, userId: 'user-2', date: '2026-07-02' });
    localToggleCompletion({ habitId: mine.id, userId: 'user-1', date: '2026-07-02' });
    localToggleCompletion({ habitId: mine.id, userId: 'user-1', date: '2026-07-01' });

    const { habits, completions } = hydrateHabitsData('user-1');

    expect(habits.map((habit) => habit.name)).toEqual(['Read', 'Run']);
    expect(completions).toEqual({ [mine.id]: ['2026-07-01', '2026-07-02'] });
    expect(habits[0].id).toBe(mine.id);
    expect(habits[1].id).toBe(later.id);
  });
});

describe('mergeServerData', () => {
  it('upserts server rows and deletes local rows the server no longer has', () => {
    // A habit that exists only locally with NO queued mutation means it was
    // deleted (or never existed) upstream — clear its mirror row.
    applyServerHabit(makeServerHabit({ id: 'habit-stale', name: 'Stale' }));
    applyServerCompletion(
      makeServerCompletion({ id: 'completion-stale', habit_id: 'habit-stale' }),
    );

    const serverHabit = makeServerHabit();
    const serverCompletion = makeServerCompletion();
    mergeServerData('user-1', [serverHabit], [serverCompletion]);

    const { habits, completions } = hydrateHabitsData('user-1');
    expect(habits).toEqual([serverHabit]);
    expect(completions).toEqual({ 'habit-server': ['2026-07-02'] });
  });

  it('never deletes or overwrites entities with queued local mutations', () => {
    // Created offline: not on the server yet, create still queued.
    const offlineHabit = localCreateHabit('user-1', INPUT);
    localToggleCompletion({ habitId: offlineHabit.id, userId: 'user-1', date: '2026-07-02' });
    // Edited offline: exists on the server with older values.
    const editedHabit = localCreateHabit('user-1', { ...INPUT, name: 'Meditate' });
    getLocalDb().runSync('DELETE FROM sync_queue WHERE entity_id = ?', [editedHabit.id]);
    localUpdateHabit('user-1', editedHabit.id, { name: 'Meditate daily' });

    mergeServerData(
      'user-1',
      [makeServerHabit({ id: editedHabit.id, name: 'Meditate' })],
      [],
    );

    const { habits, completions } = hydrateHabitsData('user-1');
    // The offline creation survives the merge even though the server snapshot
    // does not contain it, and the offline edit is not clobbered by the
    // server's older copy — both are resolved by the DRAIN, not the merge.
    expect(habits.map((habit) => habit.name).sort()).toEqual(['Meditate daily', 'Read']);
    expect(completions[offlineHabit.id]).toEqual(['2026-07-02']);
  });

  it('replaces a local completion whose id differs for the same habit/date', () => {
    // Toggled on two devices: ids differ, logical key is the same. The
    // server's row must win locally without leaving a duplicate behind.
    applyServerCompletion(makeServerCompletion({ id: 'local-id' }));

    mergeServerData(
      'user-1',
      [makeServerHabit()],
      [makeServerCompletion({ id: 'server-id' })],
    );

    const rows = getLocalDb().getAllSync<{ id: string }>(
      "SELECT id FROM habit_completions WHERE habit_id = 'habit-server'",
    );
    expect(rows).toEqual([{ id: 'server-id' }]);
  });

  it('ignores rows belonging to other users (defense in depth over RLS breadth)', () => {
    mergeServerData(
      'user-1',
      [makeServerHabit({ id: 'habit-peer', user_id: 'user-2' })],
      [makeServerCompletion({ id: 'completion-peer', habit_id: 'habit-peer', user_id: 'user-2' })],
    );

    expect(hydrateHabitsData('user-1').habits).toEqual([]);
    expect(hydrateHabitsData('user-2').habits).toEqual([]);
  });

  it('normalizes server timestamp formats so local ordering stays consistent', () => {
    mergeServerData(
      'user-1',
      [makeServerHabit({ created_at: '2026-07-01T00:00:00+00:00' })],
      [],
    );

    expect(hydrateHabitsData('user-1').habits[0].created_at).toBe('2026-07-01T00:00:00.000Z');
  });
});

// Reported real-device scenario, exercised through the REAL SQLite write path
// (not just the pure math): a daily habit completed the day before yesterday,
// deliberately left unmarked yesterday, then marked today. The concern was a
// phantom "yesterday" completion sneaking into the local mirror and inflating
// the streak. Dates are relative to the real clock so the "today/yesterday"
// current-streak window applies exactly as it does on device.
describe('one-day-gap scenario through the local mirror', () => {
  const today = todayLocalISO();
  const twoDaysAgo = addDays(today, -2);
  const dailyHabit: Pick<Habit, 'frequency' | 'target_days_per_week'> = {
    frequency: 'daily',
    target_days_per_week: null,
  };

  it('never materializes a yesterday row when only day-before-yesterday and today are toggled', () => {
    const habit = localCreateHabit('user-1', INPUT);

    // a. complete today-2, b. skip today-1 entirely, c. complete today.
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: twoDaysAgo });
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: today });

    // d. exactly [today-2, today] in SQLite — no phantom yesterday row.
    const rows = getLocalDb().getAllSync<{ completed_on: string }>(
      'SELECT completed_on FROM habit_completions WHERE habit_id = ? ORDER BY completed_on',
      [habit.id],
    );
    expect(rows.map((row) => row.completed_on)).toEqual([twoDaysAgo, today]);
    const dates = hydrateHabitsData('user-1').completions[habit.id];
    expect(dates).toEqual([twoDaysAgo, today]);

    // e. the derived current streak is 1 (today only; the gap dropped the
    // older single day out of the current run).
    expect(computeHabitStreak(dailyHabit, dates, today)).toEqual({ current: 1, longest: 1 });

    // f. unchecking today drops back to exactly [today-2] and current 0.
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: today });
    const afterUncheck = hydrateHabitsData('user-1').completions[habit.id];
    expect(afterUncheck).toEqual([twoDaysAgo]);
    expect(computeHabitStreak(dailyHabit, afterUncheck, today)).toEqual({ current: 0, longest: 1 });
  });

  it('survives an app restart mid-sequence without inventing a yesterday row', () => {
    const habit = localCreateHabit('user-1', INPUT);
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: twoDaysAgo });

    // Simulate the process dying and relaunching: drop the handle, reopen.
    closeLocalDb();

    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: today });
    const dates = hydrateHabitsData('user-1').completions[habit.id];
    expect(dates).toEqual([twoDaysAgo, today]);
    expect(computeHabitStreak(dailyHabit, dates, today)).toEqual({ current: 1, longest: 1 });
  });

  it('a server reconciliation cannot resurrect the unmarked yesterday', () => {
    const habit = localCreateHabit('user-1', INPUT);
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: twoDaysAgo });
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: today });
    // Drain the queue rows so these completions are treated as already synced
    // (no pending mutation shields them from the merge).
    getLocalDb().runSync('DELETE FROM sync_queue WHERE user_id = ?', ['user-1']);

    // The server snapshot agrees exactly: today-2 and today, no yesterday.
    mergeServerData(
      'user-1',
      [makeServerHabit({ id: habit.id, user_id: 'user-1' })],
      [
        makeServerCompletion({ id: 'srv-1', habit_id: habit.id, completed_on: twoDaysAgo }),
        makeServerCompletion({ id: 'srv-2', habit_id: habit.id, completed_on: today }),
      ],
    );

    const dates = hydrateHabitsData('user-1').completions[habit.id];
    expect(dates).toEqual([twoDaysAgo, today]);
    expect(computeHabitStreak(dailyHabit, dates, today)).toEqual({ current: 1, longest: 1 });
  });
});

describe('getSyncQueueSummary', () => {
  it('maps queue rows (habit and completion) to their habit ids and flags failures', () => {
    const habit = localCreateHabit('user-1', INPUT);
    const other = localCreateHabit('user-1', { ...INPUT, name: 'Run' });
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    getLocalDb().runSync("UPDATE sync_queue SET status = 'failed' WHERE entity_id = ?", [
      other.id,
    ]);

    const summary = getSyncQueueSummary('user-1');

    expect(summary.pendingHabitIds).toEqual([habit.id, other.id].sort());
    expect(summary.hasFailures).toBe(true);
  });

  it('is empty for a drained queue', () => {
    expect(getSyncQueueSummary('user-1')).toEqual({ pendingHabitIds: [], hasFailures: false });
  });
});
