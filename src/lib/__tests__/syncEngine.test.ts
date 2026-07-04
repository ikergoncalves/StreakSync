// Sync engine tests run against the REAL local database (expo-sqlite backed
// by better-sqlite3, see __mocks__/expo-sqlite.ts) with only the Supabase
// data layer mocked — so queue rows, version guards, and mirror overwrites
// are exercised with real SQL semantics.

import { deleteDatabaseSync } from 'expo-sqlite';

import * as habitsApi from '../habits';
import { closeLocalDb, listAllQueueRows, LOCAL_DB_NAME } from '../localDb';
import {
  applyServerCompletion,
  getLocalHabit,
  hydrateHabitsData,
  localCreateHabit,
  localSoftDeleteHabit,
  localToggleCompletion,
  localUpdateHabit,
} from '../localHabits';
import { drainSyncQueue, isTransientSyncError, MAX_SYNC_ATTEMPTS, reconcile } from '../syncEngine';
import { Habit, HabitCompletion } from '../../types';

jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual<typeof import('crypto')>('crypto').randomUUID(),
}));

jest.mock('../habits', () => ({
  listHabits: jest.fn(),
  listCompletions: jest.fn(),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  softDeleteHabit: jest.fn(),
  toggleCompletion: jest.fn(),
  getHabit: jest.fn(),
  getCompletion: jest.fn(),
}));

const mockedApi = habitsApi as jest.Mocked<typeof habitsApi>;

const INPUT = {
  name: 'Read',
  description: null,
  icon: '📚',
  color: '#10b981',
  frequency: 'daily' as const,
  target_days_per_week: null,
};

const NETWORK_ERROR = () => new Error('Network request failed');
const PERMANENT_ERROR = () =>
  Object.assign(new Error('permission denied for table habits'), { code: '42501' });

/** A timestamp guaranteed to be newer than any local write made in this test run. */
const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = '2026-01-01T00:00:00.000Z';

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
    created_at: PAST,
    updated_at: PAST,
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
    created_at: PAST,
    updated_at: PAST,
    ...overrides,
  };
}

/** Creates a habit that both sides already agree on (no pending queue rows). */
function seedSyncedHabit(name = 'Read'): Habit {
  const habit = localCreateHabit('user-1', { ...INPUT, name });
  // Simulate the create having drained in a previous session.
  const db = jest.requireActual<typeof import('../localDb')>('../localDb');
  db.getLocalDb().runSync('DELETE FROM sync_queue WHERE entity_id = ?', [habit.id]);
  return habit;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  closeLocalDb();
  deleteDatabaseSync(LOCAL_DB_NAME);
  mockedApi.getCompletion.mockResolvedValue(null);
  mockedApi.toggleCompletion.mockResolvedValue(undefined);
  mockedApi.createHabit.mockResolvedValue(makeServerHabit());
  mockedApi.updateHabit.mockResolvedValue(makeServerHabit());
  mockedApi.softDeleteHabit.mockResolvedValue(undefined);
});

describe('drainSyncQueue — happy path', () => {
  it('replays mutations in creation order through the existing data layer', async () => {
    const habit = localCreateHabit('user-1', INPUT);
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    localUpdateHabit('user-1', habit.id, { name: 'Read books' });
    localSoftDeleteHabit('user-1', habit.id);
    const calls: string[] = [];
    mockedApi.createHabit.mockImplementation(async () => (calls.push('create'), habit));
    mockedApi.toggleCompletion.mockImplementation(async () => void calls.push('toggle'));
    mockedApi.getHabit.mockResolvedValue(makeServerHabit({ id: habit.id, updated_at: PAST }));
    mockedApi.updateHabit.mockImplementation(async () => (calls.push('update'), habit));
    mockedApi.softDeleteHabit.mockImplementation(async () => void calls.push('delete'));

    const result = await drainSyncQueue('user-1');

    expect(calls).toEqual(['create', 'toggle', 'update', 'delete']);
    expect(result).toMatchObject({ synced: 4, serverWins: 0, permanentFailures: 0 });
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('pushes a queued create with the client-generated id and creation time', async () => {
    const habit = localCreateHabit('user-1', INPUT);

    await drainSyncQueue('user-1');

    expect(mockedApi.createHabit).toHaveBeenCalledWith('user-1', INPUT, {
      id: habit.id,
      createdAt: habit.created_at,
    });
  });

  it('pushes a queued completion with the client-generated id', async () => {
    const habit = seedSyncedHabit();
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    const localCompletionId = hydrateHabitsData('user-1').completions[habit.id]
      ? jest
          .requireActual<typeof import('../localDb')>('../localDb')
          .getLocalDb()
          .getFirstSync<{ id: string }>('SELECT id FROM habit_completions WHERE habit_id = ?', [
            habit.id,
          ])!.id
      : '';

    await drainSyncQueue('user-1');

    expect(mockedApi.toggleCompletion).toHaveBeenCalledWith({
      habitId: habit.id,
      userId: 'user-1',
      date: '2026-07-02',
      completed: true,
      id: localCompletionId,
    });
  });

  it('treats a unique violation on a replayed create as success', async () => {
    // A crash between the server accepting the insert and the queue row
    // being deleted replays the create; the duplicate is the desired state.
    localCreateHabit('user-1', INPUT);
    mockedApi.createHabit.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    );

    const result = await drainSyncQueue('user-1');

    expect(result).toMatchObject({ synced: 1, permanentFailures: 0 });
    expect(listAllQueueRows('user-1')).toEqual([]);
  });
});

describe('drainSyncQueue — failure handling', () => {
  it('aborts the pass on a network error, keeping every row pending', async () => {
    localCreateHabit('user-1', INPUT);
    localCreateHabit('user-1', { ...INPUT, name: 'Run' });
    mockedApi.createHabit.mockRejectedValue(NETWORK_ERROR());

    const result = await drainSyncQueue('user-1');

    // Everything after the first failure would fail identically — one
    // attempt is charged, the rest of the pass is abandoned.
    expect(result.abortedByNetworkError).toBe(true);
    expect(mockedApi.createHabit).toHaveBeenCalledTimes(1);
    const rows = listAllQueueRows('user-1');
    expect(rows.map((row) => [row.status, row.attempts])).toEqual([
      ['pending', 1],
      ['pending', 0],
    ]);
  });

  it('never marks a row failed for network errors, no matter how many attempts', async () => {
    localCreateHabit('user-1', INPUT);
    mockedApi.createHabit.mockRejectedValue(NETWORK_ERROR());

    for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS + 2; attempt += 1) {
      await drainSyncQueue('user-1');
    }

    // Offline is not a failure of the mutation: the row waits for
    // connectivity forever instead of being given up on.
    const [row] = listAllQueueRows('user-1');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(MAX_SYNC_ATTEMPTS + 2);

    // ...and connectivity returning is all it takes to finish the job.
    mockedApi.createHabit.mockResolvedValue(makeServerHabit());
    await drainSyncQueue('user-1');
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('marks a row failed after the attempt cap on permanent errors and stops retrying', async () => {
    localCreateHabit('user-1', INPUT);
    mockedApi.createHabit.mockRejectedValue(PERMANENT_ERROR());

    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
      await drainSyncQueue('user-1');
      const [row] = listAllQueueRows('user-1');
      expect(row.attempts).toBe(attempt);
      expect(row.status).toBe(attempt < MAX_SYNC_ATTEMPTS ? 'pending' : 'failed');
      expect(row.last_error).toContain('permission denied');
    }

    // Past the cap, the row is dead: no further server calls, ever — it is
    // surfaced to the user by the sync-issue banner instead of retrying
    // forever silently.
    await drainSyncQueue('user-1');
    await drainSyncQueue('user-1');
    expect(mockedApi.createHabit).toHaveBeenCalledTimes(MAX_SYNC_ATTEMPTS);
  });

  it('skips later rows for the failing habit but still processes other habits', async () => {
    const failing = localCreateHabit('user-1', INPUT);
    localToggleCompletion({ habitId: failing.id, userId: 'user-1', date: '2026-07-02' });
    localCreateHabit('user-1', { ...INPUT, name: 'Run' });
    mockedApi.createHabit.mockImplementation(async (_userId, input) => {
      if (input.name === 'Read') {
        throw PERMANENT_ERROR();
      }
      return makeServerHabit();
    });

    const result = await drainSyncQueue('user-1');

    // The completion depends on its habit existing server-side; attempting
    // it would burn attempts on a certain failure. The unrelated habit is
    // unaffected.
    expect(mockedApi.toggleCompletion).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(mockedApi.createHabit).toHaveBeenCalledTimes(2);
    const toggleRow = listAllQueueRows('user-1').find(
      (row) => row.operation === 'toggle_completion',
    )!;
    expect(toggleRow).toMatchObject({ attempts: 0, status: 'pending' });
  });
});

describe('drainSyncQueue — conflict resolution (last-write-wins)', () => {
  it('drops a queued edit and overwrites the mirror when the server row is newer', async () => {
    const habit = seedSyncedHabit();
    localUpdateHabit('user-1', habit.id, { name: 'Local rename' });
    const serverRow = makeServerHabit({ id: habit.id, name: 'Remote rename', updated_at: FUTURE });
    mockedApi.getHabit.mockResolvedValue(serverRow);

    const result = await drainSyncQueue('user-1');

    expect(mockedApi.updateHabit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ serverWins: 1, synced: 0 });
    // The loser does not duplicate or corrupt local state: exactly one row,
    // carrying the server's version.
    const { habits } = hydrateHabitsData('user-1');
    expect(habits).toHaveLength(1);
    expect(habits[0].name).toBe('Remote rename');
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('pushes the queued edit when the local write is newer than the server row', async () => {
    const habit = seedSyncedHabit();
    localUpdateHabit('user-1', habit.id, { name: 'Local rename' });
    mockedApi.getHabit.mockResolvedValue(makeServerHabit({ id: habit.id, updated_at: PAST }));

    const result = await drainSyncQueue('user-1');

    expect(mockedApi.updateHabit).toHaveBeenCalledWith(habit.id, { name: 'Local rename' });
    expect(result).toMatchObject({ synced: 1, serverWins: 0 });
    expect(getLocalHabit(habit.id)!.name).toBe('Local rename');
  });

  it('drops a queued edit for a habit hard-deleted upstream and clears the mirror', async () => {
    const habit = seedSyncedHabit();
    localUpdateHabit('user-1', habit.id, { name: 'Local rename' });
    mockedApi.getHabit.mockResolvedValue(null);

    await drainSyncQueue('user-1');

    expect(mockedApi.updateHabit).not.toHaveBeenCalled();
    expect(getLocalHabit(habit.id)).toBeNull();
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('resurrects a completion locally when the server rewrote it after the local uncheck', async () => {
    const habit = seedSyncedHabit();
    applyServerCompletion(
      makeServerCompletion({ id: 'completion-1', habit_id: habit.id, completed_on: '2026-07-02' }),
    );
    // Uncheck locally (queued completed=false)...
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    expect(hydrateHabitsData('user-1').completions[habit.id]).toBeUndefined();
    // ...but another device re-completed it AFTER our local write.
    mockedApi.getCompletion.mockResolvedValue(
      makeServerCompletion({ habit_id: habit.id, completed_on: '2026-07-02', updated_at: FUTURE }),
    );

    const result = await drainSyncQueue('user-1');

    expect(mockedApi.toggleCompletion).not.toHaveBeenCalled();
    expect(result).toMatchObject({ serverWins: 1 });
    expect(hydrateHabitsData('user-1').completions[habit.id]).toEqual(['2026-07-02']);
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('treats already-converged toggles as synced without server writes', async () => {
    const habit = seedSyncedHabit();
    // Toggle ON, but the server already has the completion (another device).
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    mockedApi.getCompletion.mockResolvedValue(
      makeServerCompletion({ id: 'server-id', habit_id: habit.id, completed_on: '2026-07-02' }),
    );

    await drainSyncQueue('user-1');

    expect(mockedApi.toggleCompletion).not.toHaveBeenCalled();
    // Mirror aligned to the server row (id converges), still one completion.
    const db = jest.requireActual<typeof import('../localDb')>('../localDb').getLocalDb();
    expect(
      db.getAllSync<{ id: string }>('SELECT id FROM habit_completions WHERE habit_id = ?', [
        habit.id,
      ]),
    ).toEqual([{ id: 'server-id' }]);

    // Toggle OFF when the server never had the row: also a no-op.
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-03' });
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-03' });
    mockedApi.getCompletion.mockResolvedValue(null);
    await drainSyncQueue('user-1');
    expect(mockedApi.toggleCompletion).not.toHaveBeenCalled();
    expect(listAllQueueRows('user-1')).toEqual([]);
  });
});

describe('drainSyncQueue — concurrency guard', () => {
  it('never runs two drains concurrently, even under rapid flapping', async () => {
    localCreateHabit('user-1', INPUT);
    localCreateHabit('user-1', { ...INPUT, name: 'Run' });
    let active = 0;
    let maxActive = 0;
    const gates: (() => void)[] = [];
    mockedApi.createHabit.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active -= 1;
      return makeServerHabit();
    });

    // Two triggers land back to back (reconnect + foreground, say), neither
    // awaiting the other — exactly the overlap the guard must serialize.
    const first = drainSyncQueue('user-1');
    const second = drainSyncQueue('user-1');
    await flush();
    expect(active).toBe(1);
    while (gates.length > 0) {
      gates.shift()!();
      await flush();
    }
    await Promise.all([first, second]);

    // One server call in flight at any moment, and each queued mutation
    // pushed exactly once — overlapping drains would have read the same
    // pending rows and pushed both twice (4 calls, maxActive 2).
    expect(maxActive).toBe(1);
    expect(mockedApi.createHabit).toHaveBeenCalledTimes(2);
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('picks up rows enqueued while a drain is running via the chained pass', async () => {
    const habit = seedSyncedHabit();
    localCreateHabit('user-1', { ...INPUT, name: 'Run' });
    const gate = deferred();
    mockedApi.createHabit.mockImplementation(async () => {
      await gate.promise;
      return makeServerHabit();
    });

    const first = drainSyncQueue('user-1');
    await flush();
    // A mutation lands mid-drain; its own trigger chains another pass.
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    const second = drainSyncQueue('user-1');
    gate.resolve();
    await Promise.all([first, second]);

    expect(mockedApi.toggleCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ habitId: habit.id, date: '2026-07-02', completed: true }),
    );
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('does not lose a toggle collapsed while its previous payload is in flight', async () => {
    const habit = seedSyncedHabit();
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    const gate = deferred();
    mockedApi.toggleCompletion.mockImplementation(async () => {
      await gate.promise;
    });

    const drain = drainSyncQueue('user-1');
    await flush();
    // completed=true is in flight; the user toggles OFF meanwhile. The queue
    // row collapses to completed=false with a bumped version.
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    gate.resolve();
    await drain;

    // The version-guarded delete missed: the row survives, pending, with the
    // NEW state — the un-toggle was not silently swallowed by the drain that
    // synced the old payload.
    const [row] = listAllQueueRows('user-1');
    expect(row.status).toBe('pending');
    expect(JSON.parse(row.payload)).toMatchObject({ completed: false });

    // The next drain reconciles the final state (the in-flight insert landed
    // server-side; the local base is newer, so the uncheck wins and syncs).
    mockedApi.toggleCompletion.mockResolvedValue(undefined);
    mockedApi.getCompletion.mockResolvedValue(
      makeServerCompletion({ habit_id: habit.id, completed_on: '2026-07-02', updated_at: PAST }),
    );
    await drainSyncQueue('user-1');
    expect(mockedApi.toggleCompletion).toHaveBeenLastCalledWith(
      expect.objectContaining({ completed: false }),
    );
    expect(listAllQueueRows('user-1')).toEqual([]);
  });
});

describe('reconcile', () => {
  it('pulls the server snapshot, merges it, then drains pending mutations', async () => {
    const offline = localCreateHabit('user-1', INPUT);
    mockedApi.listHabits.mockResolvedValue([makeServerHabit({ id: 'habit-remote' })]);
    mockedApi.listCompletions.mockResolvedValue([
      makeServerCompletion({ habit_id: 'habit-remote' }),
    ]);

    await reconcile('user-1');

    const { habits, completions } = hydrateHabitsData('user-1');
    // The other device's habit arrived; the offline creation survived the
    // merge (its queue row protected it) and then drained to the server.
    expect(habits.map((habit) => habit.name).sort()).toEqual(['Read', 'Run']);
    expect(completions['habit-remote']).toEqual(['2026-07-02']);
    expect(mockedApi.createHabit).toHaveBeenCalledWith('user-1', INPUT, {
      id: offline.id,
      createdAt: offline.created_at,
    });
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('propagates pull failures without touching local data or the queue', async () => {
    localCreateHabit('user-1', INPUT);
    mockedApi.listHabits.mockRejectedValue(NETWORK_ERROR());
    mockedApi.listCompletions.mockResolvedValue([]);

    await expect(reconcile('user-1')).rejects.toThrow('Network request failed');

    expect(hydrateHabitsData('user-1').habits).toHaveLength(1);
    expect(listAllQueueRows('user-1')).toHaveLength(1);
  });

  it('serializes with drains: a drain triggered mid-reconcile cannot interleave', async () => {
    const habit = seedSyncedHabit();
    const pullGate = deferred();
    mockedApi.listHabits.mockImplementation(async () => {
      await pullGate.promise;
      return [makeServerHabit({ id: habit.id, name: 'Read' })];
    });
    mockedApi.listCompletions.mockResolvedValue([]);

    const reconciling = reconcile('user-1');
    await flush();
    // While the pull is in flight the user toggles a completion; the
    // mutation's own drain trigger must run AFTER the merge, or the merge
    // (whose snapshot predates the toggle) could delete the fresh local row.
    localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-02' });
    const drain = drainSyncQueue('user-1');
    pullGate.resolve();
    await Promise.all([reconciling, drain]);

    expect(hydrateHabitsData('user-1').completions[habit.id]).toEqual(['2026-07-02']);
    expect(mockedApi.toggleCompletion).toHaveBeenCalledTimes(1);
    expect(listAllQueueRows('user-1')).toEqual([]);
  });
});

describe('isTransientSyncError', () => {
  it('classifies connectivity failures as transient', () => {
    expect(isTransientSyncError(new Error('Network request failed'))).toBe(true);
    expect(isTransientSyncError(new Error('fetch failed'))).toBe(true);
    expect(isTransientSyncError(new Error('Request timeout'))).toBe(true);
  });

  it('classifies data-layer rejections as permanent', () => {
    expect(isTransientSyncError(PERMANENT_ERROR())).toBe(false);
    expect(isTransientSyncError(new Error('duplicate key value'))).toBe(false);
    expect(isTransientSyncError('not even an error')).toBe(false);
  });
});
