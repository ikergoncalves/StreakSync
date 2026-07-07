import { Session, User } from '@supabase/supabase-js';
import { deleteDatabaseSync } from 'expo-sqlite';

import { SOLE_OWNER_BLOCKED_CODE } from '../../lib/accountDeletion';
import { reconcileHabitReminders } from '../../lib/habitReminders';
import { closeLocalDb, getLocalDb, listAllQueueRows, LOCAL_DB_NAME } from '../../lib/localDb';
import { hydrateHabitsData, localCreateHabit, localToggleCompletion } from '../../lib/localHabits';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { useAuthStore } from '../auth';
import { useGroupsStore } from '../groups';
import { useHabitsStore } from '../habits';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => jest.requireActual<typeof import('crypto')>('crypto').randomUUID()),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      signOut: jest.fn(),
    },
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

// The reminder module is covered by its own tests; here it only matters that
// the store CALLS it (with the clear-everything arguments) at the right point.
jest.mock('../../lib/habitReminders', () => ({
  reconcileHabitReminders: jest.fn().mockResolvedValue(undefined),
  scheduleHabitReminder: jest.fn().mockResolvedValue(undefined),
  cancelHabitReminder: jest.fn().mockResolvedValue(undefined),
}));

// Side-channel modules the habits/groups stores pull in at import time; all
// have their own suites, and stubbing them keeps this test on the deletion
// flow (same set as habits.test.ts).
jest.mock('../../lib/pushTokens', () => ({
  listGroupPeerTokens: jest.fn().mockResolvedValue([]),
  deleteInvalidTokens: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/expoPush', () => ({
  sendExpoPushMessages: jest.fn().mockResolvedValue({ tickets: [], invalidTokens: [] }),
}));
jest.mock('../../lib/activity', () => ({
  listActivityEvents: jest.fn(),
  insertActivityEvent: jest.fn(),
}));
jest.mock('../../lib/groups', () => ({
  listMyGroups: jest.fn(),
  createGroup: jest.fn(),
  joinGroupByInviteCode: jest.fn(),
  listGroupMembers: jest.fn(),
  listMemberHabitData: jest.fn(),
  leaveGroup: jest.fn(),
  deleteGroup: jest.fn(),
}));

const mockedRpc = supabase.rpc as jest.Mock;
const mockedSignOut = supabase.auth.signOut as jest.Mock;
const mockedReconcileReminders = reconcileHabitReminders as jest.Mock;

const fakeUser = { id: 'user-1', email: 'ada@example.com' } as User;
const fakeSession = { user: fakeUser, access_token: 'token' } as Session;
const fakeProfile: Profile = {
  id: 'user-1',
  username: 'ada',
  display_name: 'Ada',
  avatar_url: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

const HABIT_INPUT = {
  name: 'Read',
  description: null,
  icon: '📚',
  color: '#10b981',
  frequency: 'daily' as const,
  target_days_per_week: null,
};

/** Seeds the local mirror and the in-memory stores as a signed-in user. */
function seedSignedInUser() {
  const habit = localCreateHabit('user-1', HABIT_INPUT);
  localToggleCompletion({ habitId: habit.id, userId: 'user-1', date: '2026-07-07' });
  useAuthStore.setState({
    session: fakeSession,
    user: fakeUser,
    profile: fakeProfile,
    isLoading: false,
  });
  useHabitsStore.setState({
    habits: [habit],
    completions: { [habit.id]: ['2026-07-07'] },
    pendingSyncHabitIds: [habit.id],
  });
  useGroupsStore.setState({
    myGroups: [
      {
        id: 'group-1',
        name: 'Morning crew',
        invite_code: 'A7K2M9XZ',
        owner_id: 'user-1',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        member_count: 1,
      },
    ],
    activeGroupId: 'group-1',
  });
  return habit;
}

function countLocalHabits(): number {
  return getLocalDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM habits')?.n ?? -1;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedReconcileReminders.mockResolvedValue(undefined);
  closeLocalDb();
  deleteDatabaseSync(LOCAL_DB_NAME);
  useAuthStore.setState({ session: null, user: null, profile: null, isLoading: false });
  useHabitsStore.setState({ habits: [], completions: {}, pendingSyncHabitIds: [] });
  useGroupsStore.setState({ myGroups: [], activeGroupId: null });
});

describe('deleteAccount — success path', () => {
  it('wipes local data BEFORE tearing the session down, in the documented order', async () => {
    seedSignedInUser();
    mockedRpc.mockResolvedValue({ data: null, error: null });

    // Reminders must be cleared while the account's data is still local (step
    // 1 of the cleanup); capture what the world looked like at that moment.
    let habitsAtReminderClear = -1;
    mockedReconcileReminders.mockImplementation(() => {
      habitsAtReminderClear = countLocalHabits();
      return Promise.resolve();
    });
    // By the time the session is dropped (last step), every local trace must
    // already be gone — this is the order guarantee the spec demands.
    let habitsAtSignOut = -1;
    let storeHabitsAtSignOut = -1;
    mockedSignOut.mockImplementation(() => {
      habitsAtSignOut = countLocalHabits();
      storeHabitsAtSignOut = useHabitsStore.getState().habits.length;
      return Promise.resolve({ error: null });
    });

    const result = await useAuthStore.getState().deleteAccount();

    expect(result.error).toBeNull();
    expect(mockedRpc).toHaveBeenCalledWith('delete_own_account');
    expect(mockedReconcileReminders).toHaveBeenCalledWith([], {});
    expect(habitsAtReminderClear).toBe(1); // reminders first, data still there
    expect(habitsAtSignOut).toBe(0); // sign-out last, database already fresh
    expect(storeHabitsAtSignOut).toBe(0); // and the stores already cleared
    // Local scope: the server session died with the auth.users row.
    expect(mockedSignOut).toHaveBeenCalledWith({ scope: 'local' });

    const auth = useAuthStore.getState();
    expect(auth.session).toBeNull();
    expect(auth.user).toBeNull();
    expect(auth.profile).toBeNull();
    expect(useGroupsStore.getState().myGroups).toEqual([]);
    expect(useGroupsStore.getState().activeGroupId).toBeNull();
  });

  it('leaves a fresh, empty database for the NEXT account on this device', async () => {
    seedSignedInUser();
    mockedRpc.mockResolvedValue({ data: null, error: null });
    mockedSignOut.mockResolvedValue({ error: null });

    await useAuthStore.getState().deleteAccount();

    // Simulate the app being killed and a different person signing up on
    // this device: reopen from disk and look for any stale rows.
    closeLocalDb();
    expect(hydrateHabitsData('user-1')).toEqual({ habits: [], completions: {} });
    expect(listAllQueueRows('user-1')).toEqual([]);
    expect(countLocalHabits()).toBe(0);

    // The new user's writes land in a clean schema, unpolluted by user-1.
    const newHabit = localCreateHabit('user-2', { ...HABIT_INPUT, name: 'Run' });
    expect(hydrateHabitsData('user-2').habits).toEqual([newHabit]);
    expect(hydrateHabitsData('user-1')).toEqual({ habits: [], completions: {} });
  });

  it('still completes (and signs the UI out) when the local sign-out throws', async () => {
    seedSignedInUser();
    mockedRpc.mockResolvedValue({ data: null, error: null });
    mockedSignOut.mockRejectedValue(new Error('storage unavailable'));

    const result = await useAuthStore.getState().deleteAccount();

    // The account is gone server-side; a sign-out hiccup must not be
    // reported as a deletion failure.
    expect(result.error).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
  });
});

describe('deleteAccount — refusals leave everything intact', () => {
  it('surfaces the sole-owner block and touches nothing local', async () => {
    const habit = seedSignedInUser();
    mockedRpc.mockResolvedValue({
      data: null,
      error: {
        code: SOLE_OWNER_BLOCKED_CODE,
        message:
          'You are the only owner of shared groups that still have other members: "Morning crew".',
      },
    });

    const result = await useAuthStore.getState().deleteAccount();

    expect(result.error).toMatch(/"Morning crew"/);
    expect(mockedReconcileReminders).not.toHaveBeenCalled();
    expect(mockedSignOut).not.toHaveBeenCalled();
    expect(hydrateHabitsData('user-1').habits).toEqual([habit]);
    expect(useAuthStore.getState().session).toBe(fakeSession);
    expect(useHabitsStore.getState().habits).toEqual([habit]);
  });

  it('surfaces a network failure and touches nothing local', async () => {
    const habit = seedSignedInUser();
    mockedRpc.mockRejectedValue(new Error('Network request failed'));

    const result = await useAuthStore.getState().deleteAccount();

    expect(result.error).toMatch(/connection/i);
    expect(mockedSignOut).not.toHaveBeenCalled();
    expect(hydrateHabitsData('user-1').habits).toEqual([habit]);
    expect(useAuthStore.getState().session).toBe(fakeSession);
  });

  it('refuses when nobody is signed in, without calling the RPC', async () => {
    const result = await useAuthStore.getState().deleteAccount();

    expect(result.error).toMatch(/signed in/i);
    expect(mockedRpc).not.toHaveBeenCalled();
  });
});
