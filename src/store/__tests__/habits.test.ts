// Habits store tests run the REAL local-first stack — store, localHabits,
// localDb (expo-sqlite backed by better-sqlite3) and the sync engine — with
// only the Supabase data layer mocked. That makes these integration tests of
// the offline flow: a toggle here writes actual SQLite rows and queue
// entries, and "going online" drains them through the mocked server.

import { deleteDatabaseSync } from 'expo-sqlite';

import * as activityApi from '../../lib/activity';
import * as groupsApi from '../../lib/groups';
import { GroupWithMemberCount } from '../../lib/groups';
import * as habitsApi from '../../lib/habits';
import { closeLocalDb, listAllQueueRows, LOCAL_DB_NAME } from '../../lib/localDb';
import { applyServerCompletion, applyServerHabit } from '../../lib/localHabits';
import { setOnlineStatus } from '../../lib/network';
import { addDays, todayLocalISO } from '../../lib/streaks';
import { GroupMember, Habit, HabitCompletion } from '../../types';
import { selectLeaderboard, useGroupsStore } from '../groups';
import {
  resetPublishedActivityEvents,
  selectHabitStreak,
  selectHasPendingSync,
  selectIsCompleted,
  useHabitsStore,
} from '../habits';

jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual<typeof import('crypto')>('crypto').randomUUID(),
}));

jest.mock('../../lib/habits', () => ({
  listHabits: jest.fn(),
  listCompletions: jest.fn(),
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  softDeleteHabit: jest.fn(),
  toggleCompletion: jest.fn(),
  getHabit: jest.fn(),
  getCompletion: jest.fn(),
}));

// The activity emitter writes through this; mocked so tests can assert the
// exact events a mutation produced.
jest.mock('../../lib/activity', () => ({
  listActivityEvents: jest.fn(),
  insertActivityEvent: jest.fn(),
}));

// The groups store (read by the emitter for fan-out) is real, but its data
// layer touches the supabase client, so stub that out.
jest.mock('../../lib/groups', () => ({
  listMyGroups: jest.fn(),
  createGroup: jest.fn(),
  joinGroupByInviteCode: jest.fn(),
  listGroupMembers: jest.fn(),
  listMemberHabitData: jest.fn(),
  leaveGroup: jest.fn(),
}));

// The auth store pulls in the supabase client (which needs env config); the
// habits store only reads the signed-in user from it, so stub the module.
jest.mock('../auth', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

const mockedApi = habitsApi as jest.Mocked<typeof habitsApi>;
const mockedActivityApi = activityApi as jest.Mocked<typeof activityApi>;
const mockedGroupsApi = groupsApi as jest.Mocked<typeof groupsApi>;

const INPUT = {
  name: 'Read',
  description: null,
  icon: '📚',
  color: '#10b981',
  frequency: 'daily' as const,
  target_days_per_week: null,
};

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

function makeCompletion(overrides: Partial<HabitCompletion> = {}): HabitCompletion {
  return {
    id: 'completion-1',
    habit_id: 'habit-1',
    user_id: 'user-1',
    completed_on: '2026-07-02',
    created_at: '2026-07-02T12:00:00.000Z',
    updated_at: '2026-07-02T12:00:00.000Z',
    ...overrides,
  };
}

/** Seeds a habit both sides already agree on: SQLite mirror + store state, no queue row. */
function seedSyncedHabit(habit: Habit): void {
  applyServerHabit(habit);
  useHabitsStore.setState((state) => ({ habits: [...state.habits, habit] }));
}

/** Seeds completions the same way (SQLite + store, no queue rows). */
function seedSyncedCompletions(habitId: string, dates: string[]): void {
  for (const date of dates) {
    applyServerCompletion(
      makeCompletion({
        id: jest.requireActual<typeof import('crypto')>('crypto').randomUUID(),
        habit_id: habitId,
        completed_on: date,
      }),
    );
  }
  useHabitsStore.setState((state) => ({
    completions: { ...state.completions, [habitId]: [...dates].sort() },
  }));
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  closeLocalDb();
  deleteDatabaseSync(LOCAL_DB_NAME);
  setOnlineStatus(true);
  useHabitsStore.setState({
    habits: [],
    completions: {},
    isLoading: false,
    isSyncing: false,
    error: null,
    pendingSyncHabitIds: [],
    hasSyncFailures: false,
  });
  // No groups by default: the pre-Phase-3 tests run with emission disabled.
  useGroupsStore.setState({
    myGroups: [],
    membersByGroup: {},
    memberHabitsByGroup: {},
    memberCompletionsByGroup: {},
  });
  mockedApi.listHabits.mockResolvedValue([]);
  mockedApi.listCompletions.mockResolvedValue([]);
  mockedApi.getHabit.mockResolvedValue(null);
  mockedApi.getCompletion.mockResolvedValue(null);
  mockedApi.createHabit.mockResolvedValue(makeHabit());
  mockedApi.updateHabit.mockResolvedValue(makeHabit());
  mockedApi.softDeleteHabit.mockResolvedValue(undefined);
  mockedApi.toggleCompletion.mockResolvedValue(undefined);
  mockedActivityApi.insertActivityEvent.mockResolvedValue(undefined);
  // The session dedup registry outlives store resets; clear it per test.
  resetPublishedActivityEvents();
});

describe('load', () => {
  it('hydrates from the server snapshot via SQLite and groups completions by habit', async () => {
    const habits = [makeHabit(), makeHabit({ id: 'habit-2', name: 'Run' })];
    mockedApi.listHabits.mockResolvedValue(habits);
    mockedApi.listCompletions.mockResolvedValue([
      makeCompletion({ completed_on: '2026-07-01' }),
      makeCompletion({ id: 'completion-2', completed_on: '2026-07-02' }),
      makeCompletion({ id: 'completion-3', habit_id: 'habit-2', completed_on: '2026-07-02' }),
    ]);

    await useHabitsStore.getState().load();

    // Personal queries are scoped to the signed-in user explicitly — RLS is
    // deliberately broader (it exposes group peers' rows for the
    // leaderboard), so passing the id is part of the contract.
    expect(mockedApi.listHabits).toHaveBeenCalledWith('user-1');
    expect(mockedApi.listCompletions).toHaveBeenCalledWith('user-1');
    const state = useHabitsStore.getState();
    expect(state.habits).toEqual(habits);
    expect(state.completions).toEqual({
      'habit-1': ['2026-07-01', '2026-07-02'],
      'habit-2': ['2026-07-02'],
    });
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('never keeps habits or completions belonging to another user', async () => {
    // Defense in depth for the Today-screen leak: even if the data layer
    // returned a group peer's rows (as the unfiltered query once did), the
    // local mirror must drop them rather than mix them into the personal list.
    mockedApi.listHabits.mockResolvedValue([
      makeHabit(),
      makeHabit({ id: 'habit-peer', user_id: 'user-2', name: 'Peer habit' }),
    ]);
    mockedApi.listCompletions.mockResolvedValue([
      makeCompletion({ completed_on: '2026-07-02' }),
      makeCompletion({
        id: 'completion-peer',
        habit_id: 'habit-peer',
        user_id: 'user-2',
        completed_on: '2026-07-02',
      }),
    ]);

    await useHabitsStore.getState().load();

    const state = useHabitsStore.getState();
    expect(state.habits.map((habit) => habit.id)).toEqual(['habit-1']);
    expect(state.completions).toEqual({ 'habit-1': ['2026-07-02'] });
  });

  it('records an error message when the server pull fails, keeping local data', async () => {
    seedSyncedHabit(makeHabit());
    useHabitsStore.setState({ habits: [] });
    mockedApi.listHabits.mockRejectedValue(new Error('Network request failed'));

    await useHabitsStore.getState().load();

    const state = useHabitsStore.getState();
    expect(state.error).toMatch(/connection/i);
    expect(state.isLoading).toBe(false);
    // Local data is not a casualty of a failed pull.
    expect(state.habits.map((habit) => habit.id)).toEqual(['habit-1']);
  });

  it('hydrates instantly from SQLite while offline, without any server call', async () => {
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', ['2026-07-02']);
    useHabitsStore.setState({ habits: [], completions: {} });
    setOnlineStatus(false);

    await useHabitsStore.getState().load();

    const state = useHabitsStore.getState();
    expect(state.habits.map((habit) => habit.id)).toEqual(['habit-1']);
    expect(state.completions).toEqual({ 'habit-1': ['2026-07-02'] });
    expect(state.error).toBeNull();
    expect(mockedApi.listHabits).not.toHaveBeenCalled();
    expect(mockedApi.listCompletions).not.toHaveBeenCalled();
  });
});

describe('create', () => {
  it('appends the habit instantly and drains the queued create to the server', async () => {
    const result = await useHabitsStore.getState().create(INPUT);
    await flush();

    expect(result.error).toBeNull();
    const [habit] = useHabitsStore.getState().habits;
    expect(habit).toMatchObject({ ...INPUT, user_id: 'user-1', deleted_at: null });
    // The background drain replays the mutation through the existing data
    // layer, preserving the client-generated id and creation time.
    expect(mockedApi.createHabit).toHaveBeenCalledWith('user-1', INPUT, {
      id: habit.id,
      createdAt: habit.created_at,
    });
    expect(listAllQueueRows('user-1')).toEqual([]);
    expect(useHabitsStore.getState().pendingSyncHabitIds).toEqual([]);
  });

  it('works fully offline: instant state, queued mutation, no server call', async () => {
    setOnlineStatus(false);

    const result = await useHabitsStore.getState().create(INPUT);
    await flush();

    expect(result.error).toBeNull();
    const [habit] = useHabitsStore.getState().habits;
    expect(habit.name).toBe('Read');
    expect(mockedApi.createHabit).not.toHaveBeenCalled();
    expect(listAllQueueRows('user-1')).toHaveLength(1);
    expect(selectHasPendingSync(useHabitsStore.getState(), habit.id)).toBe(true);
  });

  it('does not fail the mutation when the server rejects; the row stays queued', async () => {
    mockedApi.createHabit.mockRejectedValue(new Error('Network request failed'));

    const result = await useHabitsStore.getState().create(INPUT);
    await flush();

    // The local write IS the mutation now — a server failure only means the
    // queue row waits for the next drain.
    expect(result.error).toBeNull();
    expect(useHabitsStore.getState().habits).toHaveLength(1);
    const [row] = listAllQueueRows('user-1');
    expect(row).toMatchObject({ operation: 'create', status: 'pending', attempts: 1 });
  });
});

describe('update', () => {
  it('replaces the habit in place and queues the edit', async () => {
    seedSyncedHabit(makeHabit());
    seedSyncedHabit(makeHabit({ id: 'habit-2' }));
    mockedApi.getHabit.mockResolvedValue(makeHabit());

    const result = await useHabitsStore.getState().update('habit-1', { name: 'Read books' });
    await flush();

    expect(result.error).toBeNull();
    expect(useHabitsStore.getState().habits[0].name).toBe('Read books');
    expect(useHabitsStore.getState().habits[1].id).toBe('habit-2');
    // Drained through the existing data layer (the local edit was newer than
    // the server row, so it won the LWW comparison).
    expect(mockedApi.updateHabit).toHaveBeenCalledWith('habit-1', { name: 'Read books' });
  });

  it('fails without queueing anything for an unknown habit', async () => {
    const result = await useHabitsStore.getState().update('missing', { name: 'X' });

    expect(result.error).toBeTruthy();
    expect(listAllQueueRows('user-1')).toEqual([]);
  });
});

describe('remove', () => {
  it('drops the habit and its completions instantly and queues the soft delete', async () => {
    seedSyncedHabit(makeHabit());
    seedSyncedHabit(makeHabit({ id: 'habit-2' }));
    seedSyncedCompletions('habit-1', ['2026-07-02']);
    seedSyncedCompletions('habit-2', ['2026-07-01']);

    const result = await useHabitsStore.getState().remove('habit-1');
    await flush();

    expect(result.error).toBeNull();
    const state = useHabitsStore.getState();
    expect(state.habits.map((habit) => habit.id)).toEqual(['habit-2']);
    expect(state.completions).toEqual({ 'habit-2': ['2026-07-01'] });
    expect(mockedApi.softDeleteHabit).toHaveBeenCalledWith('habit-1');
  });

  it('still works offline (deletes always win at sync time)', async () => {
    seedSyncedHabit(makeHabit());
    setOnlineStatus(false);

    const result = await useHabitsStore.getState().remove('habit-1');
    await flush();

    expect(result.error).toBeNull();
    expect(useHabitsStore.getState().habits).toEqual([]);
    expect(mockedApi.softDeleteHabit).not.toHaveBeenCalled();
    expect(listAllQueueRows('user-1').map((row) => row.operation)).toEqual(['delete']);
  });
});

describe('toggle', () => {
  it('applies the completion instantly without waiting for any network call', async () => {
    seedSyncedHabit(makeHabit());
    // The server-side toggle hangs while the assertions run — the UI must
    // not care (before Phase 4 the toggle awaited this call).
    let release!: () => void;
    mockedApi.toggleCompletion.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const result = await useHabitsStore.getState().toggle('habit-1', '2026-07-03');

    expect(result.error).toBeNull();
    expect(selectIsCompleted(useHabitsStore.getState(), 'habit-1', '2026-07-03')).toBe(true);

    // Unblock the background drain so it cannot leak into later tests.
    await flush();
    release();
    await flush();
  });

  it('keeps the completion when the server sync fails (no rollback of local truth)', async () => {
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', ['2026-07-02']);
    mockedApi.toggleCompletion.mockRejectedValue(new Error('Network request failed'));

    const result = await useHabitsStore.getState().toggle('habit-1', '2026-07-03');
    await flush();

    // Before Phase 4 this rolled back; now SQLite is the optimistic state
    // and the queue retries — the check-in is never yanked back out of the UI.
    expect(result.error).toBeNull();
    expect(useHabitsStore.getState().completions['habit-1']).toEqual([
      '2026-07-02',
      '2026-07-03',
    ]);
    expect(listAllQueueRows('user-1')).toHaveLength(1);
  });

  it('removes an existing completion and keeps dates sorted when re-adding', async () => {
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', ['2026-07-01', '2026-07-02']);

    await useHabitsStore.getState().toggle('habit-1', '2026-07-02');
    expect(useHabitsStore.getState().completions['habit-1']).toEqual(['2026-07-01']);

    await useHabitsStore.getState().toggle('habit-1', '2026-06-30');
    expect(useHabitsStore.getState().completions['habit-1']).toEqual(['2026-06-30', '2026-07-01']);
  });

  it('fails without touching state when the habit is unknown', async () => {
    const result = await useHabitsStore.getState().toggle('missing', '2026-07-03');

    expect(result.error).toBeTruthy();
    expect(listAllQueueRows('user-1')).toEqual([]);
  });
});

describe('offline-first flows', () => {
  it('collapses offline on/off/on toggles into ONE net server operation', async () => {
    seedSyncedHabit(makeHabit());
    setOnlineStatus(false);
    const today = todayLocalISO();

    await useHabitsStore.getState().toggle('habit-1');
    await useHabitsStore.getState().toggle('habit-1');
    await useHabitsStore.getState().toggle('habit-1');

    expect(listAllQueueRows('user-1')).toHaveLength(1);
    expect(selectIsCompleted(useHabitsStore.getState(), 'habit-1', today)).toBe(true);

    setOnlineStatus(true);
    await useHabitsStore.getState().syncNow();

    // One queued mutation, one server write, reflecting the FINAL state.
    expect(mockedApi.toggleCompletion).toHaveBeenCalledTimes(1);
    expect(mockedApi.toggleCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ habitId: 'habit-1', date: today, completed: true }),
    );
    expect(listAllQueueRows('user-1')).toEqual([]);
  });

  it('survives an app restart with a non-empty queue and drains it on the next launch', async () => {
    setOnlineStatus(false);
    await useHabitsStore.getState().create(INPUT);
    const created = useHabitsStore.getState().habits[0];

    // Kill the process: the handle is dropped, the database file persists.
    closeLocalDb();
    useHabitsStore.setState({
      habits: [],
      completions: {},
      isLoading: false,
      isSyncing: false,
      error: null,
      pendingSyncHabitIds: [],
      hasSyncFailures: false,
    });

    // Relaunch, still offline: the habit and its queue row are both there.
    await useHabitsStore.getState().load();
    expect(useHabitsStore.getState().habits.map((habit) => habit.id)).toEqual([created.id]);
    expect(listAllQueueRows('user-1')).toHaveLength(1);
    expect(useHabitsStore.getState().pendingSyncHabitIds).toEqual([created.id]);

    // Connectivity returns: the queued create drains with the original id.
    setOnlineStatus(true);
    await useHabitsStore.getState().syncNow();
    expect(mockedApi.createHabit).toHaveBeenCalledWith('user-1', INPUT, {
      id: created.id,
      createdAt: created.created_at,
    });
    expect(listAllQueueRows('user-1')).toEqual([]);
    expect(useHabitsStore.getState().pendingSyncHabitIds).toEqual([]);
  });

  it('applies server-wins conflict resolution visibly: a newer remote edit replaces the local one', async () => {
    seedSyncedHabit(makeHabit());
    setOnlineStatus(false);
    await useHabitsStore.getState().update('habit-1', { name: 'Offline rename' });
    expect(useHabitsStore.getState().habits[0].name).toBe('Offline rename');

    // Another device renamed the habit AFTER our offline edit.
    const remote = makeHabit({
      name: 'Remote rename',
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    });
    mockedApi.getHabit.mockResolvedValue(remote);
    mockedApi.listHabits.mockResolvedValue([remote]);

    setOnlineStatus(true);
    await useHabitsStore.getState().syncNow();

    // The loser neither duplicates nor corrupts: one habit, server's version,
    // empty queue, no lingering pending marker.
    const state = useHabitsStore.getState();
    expect(state.habits).toHaveLength(1);
    expect(state.habits[0].name).toBe('Remote rename');
    expect(mockedApi.updateHabit).not.toHaveBeenCalled();
    expect(listAllQueueRows('user-1')).toEqual([]);
    expect(state.pendingSyncHabitIds).toEqual([]);
  });

  it('surfaces repeated permanent sync failures through hasSyncFailures', async () => {
    setOnlineStatus(false);
    await useHabitsStore.getState().create(INPUT);
    setOnlineStatus(true);
    mockedApi.createHabit.mockRejectedValue(
      Object.assign(new Error('permission denied'), { code: '42501' }),
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await useHabitsStore.getState().syncNow();
    }

    // The row gave up (cap reached) and the store exposes it for the
    // sync-issue banner instead of retrying forever silently.
    expect(useHabitsStore.getState().hasSyncFailures).toBe(true);
    const [row] = listAllQueueRows('user-1');
    expect(row.status).toBe('failed');

    await useHabitsStore.getState().syncNow();
    expect(mockedApi.createHabit).toHaveBeenCalledTimes(5);
  });

  it('completes a local toggle instantly even while another sync call is in flight', async () => {
    // A drain is mid-network-call when the device effectively goes offline;
    // a toggle fired at that moment must still write + queue instantly.
    seedSyncedHabit(makeHabit());
    seedSyncedHabit(makeHabit({ id: 'habit-2', name: 'Run' }));
    setOnlineStatus(false);
    await useHabitsStore.getState().update('habit-2', { name: 'Running' });
    setOnlineStatus(true);
    mockedApi.listHabits.mockResolvedValue([makeHabit()]);
    let releaseGetHabit!: () => void;
    mockedApi.getHabit.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseGetHabit = () => resolve(makeHabit({ id: 'habit-2' }));
        }),
    );
    const syncing = useHabitsStore.getState().syncNow();
    await flush();

    setOnlineStatus(false);
    const result = await useHabitsStore.getState().toggle('habit-1', '2026-07-03');

    expect(result.error).toBeNull();
    expect(selectIsCompleted(useHabitsStore.getState(), 'habit-1', '2026-07-03')).toBe(true);
    expect(
      listAllQueueRows('user-1').filter((row) => row.operation === 'toggle_completion'),
    ).toHaveLength(1);

    releaseGetHabit();
    await syncing;
  });

  it('does not touch state references when reconciliation changes nothing (no reflow)', async () => {
    mockedApi.listHabits.mockResolvedValue([makeHabit()]);
    mockedApi.listCompletions.mockResolvedValue([makeCompletion()]);
    await useHabitsStore.getState().load();
    const { habits, completions, pendingSyncHabitIds } = useHabitsStore.getState();

    await useHabitsStore.getState().syncNow();

    // Same references — the FlatList sees no data change, so nothing flashes.
    const state = useHabitsStore.getState();
    expect(state.habits).toBe(habits);
    expect(state.completions).toBe(completions);
    expect(state.pendingSyncHabitIds).toBe(pendingSyncHabitIds);
  });
});

describe('selectHabitStreak', () => {
  it('derives the current and longest streak for a daily habit', () => {
    const state = {
      habits: [makeHabit()],
      completions: { 'habit-1': ['2026-07-01', '2026-07-02', '2026-07-03'] },
    };

    expect(selectHabitStreak(state, 'habit-1', '2026-07-03')).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it('uses the weekly calculation for weekly habits', () => {
    const state = {
      habits: [makeHabit({ frequency: 'weekly', target_days_per_week: 2 })],
      completions: { 'habit-1': ['2026-06-29', '2026-07-01'] },
    };

    expect(selectHabitStreak(state, 'habit-1', '2026-07-03')).toEqual({
      current: 1,
      longest: 1,
    });
  });

  it('returns zeros for an unknown habit', () => {
    expect(selectHabitStreak({ habits: [], completions: {} }, 'missing')).toEqual({
      current: 0,
      longest: 0,
    });
  });
});

describe('activity events', () => {
  const today = todayLocalISO();
  const daysAgo = (days: number) => addDays(today, -days);

  function makeGroup(id: string, memberCount: number): GroupWithMemberCount {
    return {
      id,
      name: 'Morning crew',
      invite_code: 'A7K2M9XZ',
      owner_id: 'user-1',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      member_count: memberCount,
    };
  }

  it('emits nothing for a user in zero groups', async () => {
    seedSyncedHabit(makeHabit());

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedActivityApi.insertActivityEvent).not.toHaveBeenCalled();
  });

  it('emits nothing to groups where the user is the only member', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-solo', 1)] });
    seedSyncedHabit(makeHabit());

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedActivityApi.insertActivityEvent).not.toHaveBeenCalled();
  });

  it('emits streak_continued to every shared group when a toggle extends a streak', async () => {
    useGroupsStore.setState({
      myGroups: [makeGroup('group-1', 2), makeGroup('group-2', 3), makeGroup('group-solo', 1)],
    });
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', [daysAgo(1)]);

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    const expectedEvent = {
      type: 'streak_continued',
      payload: expect.objectContaining({ habit_id: 'habit-1', current_streak: 2 }),
    };
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledTimes(2);
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: expectedEvent,
    });
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-2',
      userId: 'user-1',
      event: expectedEvent,
    });
  });

  it('emits streak_broken when a check-in observes a missed gap', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    seedSyncedHabit(makeHabit());
    // A 3-day run that ended three days ago; yesterday and the day before
    // were missed, so today's check-in is the first to see the break.
    seedSyncedCompletions('habit-1', [daysAgo(5), daysAgo(4), daysAgo(3)]);

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: {
        type: 'streak_broken',
        payload: expect.objectContaining({ habit_id: 'habit-1', previous_streak: 3 }),
      },
    });
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: {
        type: 'streak_continued',
        payload: expect.objectContaining({ current_streak: 1 }),
      },
    });
  });

  it('publishes streak_continued only once when a completion is re-toggled the same day', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', [daysAgo(1)]);

    // On, off, and on again: one logical action from the user's point of
    // view, and one streak_continued for this habit/date. The session
    // registry skips the re-publish client-side; migration 0005's unique
    // index is the backstop when the app restarts and re-attempts it.
    await useHabitsStore.getState().toggle('habit-1');
    await useHabitsStore.getState().toggle('habit-1');
    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledTimes(1);
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: {
        type: 'streak_continued',
        payload: expect.objectContaining({ habit_id: 'habit-1', event_date: today }),
      },
    });
  });

  it('emits nothing when a completion is unchecked', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', [today]);

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedActivityApi.insertActivityEvent).not.toHaveBeenCalled();
  });

  it('patches cached group leaderboard data immediately when the own toggle succeeds', async () => {
    const makeMember = (userId: string, username: string): GroupMember => ({
      group_id: 'group-1',
      user_id: userId,
      role: 'member',
      joined_at: '2026-07-01T00:00:00.000Z',
      profile: {
        id: userId,
        username,
        display_name: username,
        avatar_url: null,
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
    });
    const peerHabit = makeHabit({ id: 'habit-2', user_id: 'user-2', name: 'Run' });
    const peerCompletion = makeCompletion({
      id: 'completion-peer',
      habit_id: 'habit-2',
      user_id: 'user-2',
      completed_on: today,
    });
    useGroupsStore.setState({
      myGroups: [makeGroup('group-1', 2)],
      membersByGroup: { 'group-1': [makeMember('user-1', 'alice'), makeMember('user-2', 'bob')] },
      memberHabitsByGroup: { 'group-1': [makeHabit(), peerHabit] },
      memberCompletionsByGroup: { 'group-1': [peerCompletion] },
    });
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', [daysAgo(1)]);

    await useHabitsStore.getState().toggle('habit-1');

    // The user's own cached rows now match the habits store, synchronously
    // and without any refetch; the peer's row is untouched.
    const groupsState = useGroupsStore.getState();
    expect(
      groupsState.memberCompletionsByGroup['group-1']
        .filter((completion) => completion.habit_id === 'habit-1')
        .map((completion) => completion.completed_on),
    ).toEqual([daysAgo(1), today]);
    expect(groupsState.memberCompletionsByGroup['group-1']).toContainEqual(peerCompletion);
    expect(mockedGroupsApi.listGroupMembers).not.toHaveBeenCalled();
    expect(mockedGroupsApi.listMemberHabitData).not.toHaveBeenCalled();
    // The leaderboard reflects the new 2-day streak with no Realtime
    // round-trip: alice 2, bob 1.
    expect(
      selectLeaderboard(groupsState, 'group-1', today).map((entry) => [
        entry.username,
        entry.totalStreak,
      ]),
    ).toEqual([
      ['alice', 2],
      ['bob', 1],
    ]);
  });

  it('emits habit_created to shared groups when a habit is created', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });

    await useHabitsStore.getState().create(INPUT);
    await flush();

    const [habit] = useHabitsStore.getState().habits;
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      event: {
        type: 'habit_created',
        payload: { habit_id: habit.id, habit_name: 'Read', habit_icon: '📚' },
      },
    });
  });
});

describe('leaderboard cache integrity across own completion toggles', () => {
  const today = todayLocalISO();
  const daysAgo = (days: number) => addDays(today, -days);

  function makeGroup(id: string, memberCount: number): GroupWithMemberCount {
    return {
      id,
      name: 'Morning crew',
      invite_code: 'A7K2M9XZ',
      owner_id: 'user-1',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
      member_count: memberCount,
    };
  }

  function makeMember(userId: string, username: string): GroupMember {
    return {
      group_id: 'group-1',
      user_id: userId,
      role: 'member',
      joined_at: '2026-07-01T00:00:00.000Z',
      profile: {
        id: userId,
        username,
        display_name: username,
        avatar_url: null,
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
    };
  }

  // alice (user-1, signed in) has a 3-day streak on habit-1; bob (user-2, a
  // peer) has a 2-day streak on habit-2. Server-shaped rows, as loadMembers
  // would have cached them.
  const aliceHabit = makeHabit();
  const bobHabit = makeHabit({ id: 'habit-2', user_id: 'user-2', name: 'Run' });
  const aliceDates = [daysAgo(2), daysAgo(1), today];
  const aliceServerCompletions = aliceDates.map((date) =>
    makeCompletion({ id: `alice-${date}`, completed_on: date }),
  );
  const bobServerCompletions = [daysAgo(1), today].map((date) =>
    makeCompletion({ id: `bob-${date}`, habit_id: 'habit-2', user_id: 'user-2', completed_on: date }),
  );

  const leaderboardNow = () =>
    selectLeaderboard(useGroupsStore.getState(), 'group-1', today).map((entry) => [
      entry.username,
      entry.totalStreak,
    ]);
  const cachedBobHabits = () =>
    useGroupsStore.getState().memberHabitsByGroup['group-1'].filter(
      (habit) => habit.user_id === 'user-2',
    );
  const cachedBobCompletions = () =>
    useGroupsStore.getState().memberCompletionsByGroup['group-1'].filter(
      (completion) => completion.user_id === 'user-2',
    );

  function seedTwoMemberGroup(): void {
    useGroupsStore.setState({
      myGroups: [makeGroup('group-1', 2)],
      membersByGroup: { 'group-1': [makeMember('user-1', 'alice'), makeMember('user-2', 'bob')] },
      memberHabitsByGroup: { 'group-1': [aliceHabit, bobHabit] },
      memberCompletionsByGroup: {
        'group-1': [...aliceServerCompletions, ...bobServerCompletions],
      },
    });
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', aliceDates);
  }

  it('toggling own completion off and back on moves only the own entry and never touches the peer rows', async () => {
    seedTwoMemberGroup();
    expect(leaderboardNow()).toEqual([
      ['alice', 3],
      ['bob', 2],
    ]);

    // a. alice unchecks today's completion (the one extending her streak).
    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    // b. bob's cached rows are byte-for-byte untouched ("zeroes the other
    // member" regression) ...
    expect(cachedBobHabits()).toEqual([bobHabit]);
    expect(cachedBobCompletions()).toEqual(bobServerCompletions);
    // c. ... and alice's entry decreased by exactly 1.
    expect(leaderboardNow()).toEqual([
      ['alice', 2],
      ['bob', 2],
    ]);

    // d. alice toggles the same completion back on.
    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    // e. her entry is back at the original value; bob is still untouched.
    expect(leaderboardNow()).toEqual([
      ['alice', 3],
      ['bob', 2],
    ]);
    expect(cachedBobHabits()).toEqual([bobHabit]);
    expect(cachedBobCompletions()).toEqual(bobServerCompletions);
  });

  it('a stale refetch landing before the toggle finished syncing must not clobber the optimistic patch', async () => {
    seedTwoMemberGroup();

    // Hold the drain's server write open: the completion DELETE for the
    // toggle below stays in flight for the whole test.
    mockedApi.getCompletion.mockResolvedValue(
      makeCompletion({ id: `alice-${today}`, completed_on: today }),
    );
    let releaseServerToggle!: () => void;
    mockedApi.toggleCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseServerToggle = () => resolve(undefined);
        }),
    );

    // alice unchecks today; the local write and the cache patch are instant,
    // the server sync is a background drain that has NOT completed.
    await useHabitsStore.getState().toggle('habit-1');
    expect(leaderboardNow()).toEqual([
      ['alice', 2],
      ['bob', 2],
    ]);

    // An activity event round-trips through Realtime faster than the drain
    // and triggers loadMembers: the snapshot predates the toggle (alice's
    // today row still present) but carries a NEWER peer update (bob now has
    // a 3-day streak).
    const bobUpdatedCompletions = [
      ...bobServerCompletions,
      makeCompletion({
        id: `bob-${daysAgo(2)}`,
        habit_id: 'habit-2',
        user_id: 'user-2',
        completed_on: daysAgo(2),
      }),
    ];
    mockedGroupsApi.listGroupMembers.mockResolvedValue([
      makeMember('user-1', 'alice'),
      makeMember('user-2', 'bob'),
    ]);
    mockedGroupsApi.listMemberHabitData.mockResolvedValue({
      habits: [aliceHabit, bobHabit],
      completions: [...aliceServerCompletions, ...bobUpdatedCompletions],
    });
    await useGroupsStore.getState().loadMembers('group-1');

    // The out-of-date snapshot must not resurrect alice's unchecked
    // completion, while bob's newer peer data DOES come through.
    expect(leaderboardNow()).toEqual([
      ['bob', 3],
      ['alice', 2],
    ]);

    // Once the drain completes, a fresh refetch converges on pure server
    // data (which now reflects the toggle).
    releaseServerToggle();
    await flush();
    expect(useHabitsStore.getState().pendingSyncHabitIds).toEqual([]);
    const syncedSnapshot = {
      habits: [aliceHabit, bobHabit],
      completions: [...aliceServerCompletions.slice(0, 2), ...bobUpdatedCompletions],
    };
    mockedGroupsApi.listMemberHabitData.mockResolvedValue(syncedSnapshot);
    await useGroupsStore.getState().loadMembers('group-1');
    expect(useGroupsStore.getState().memberHabitsByGroup['group-1']).toEqual(
      syncedSnapshot.habits,
    );
    expect(useGroupsStore.getState().memberCompletionsByGroup['group-1']).toEqual(
      syncedSnapshot.completions,
    );
  });
});
