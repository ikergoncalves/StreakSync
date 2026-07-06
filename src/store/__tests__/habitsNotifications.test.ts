// Phase 5 wiring tests: social pushes and reminder scheduling ride the REAL
// habits store + SQLite + sync engine (like habits.test.ts), with the
// network-facing libs (supabase data layers, Expo push HTTP) and the
// notification-scheduling lib mocked at the module boundary. What is proven
// here is the store's routing: WHICH events push, to WHOM, WHEN — and that
// none of it can fail a habit mutation.

import { deleteDatabaseSync } from 'expo-sqlite';

import * as activityApi from '../../lib/activity';
import * as expoPushApi from '../../lib/expoPush';
import { GroupWithMemberCount } from '../../lib/groups';
import * as habitRemindersApi from '../../lib/habitReminders';
import * as habitsApi from '../../lib/habits';
import { closeLocalDb, LOCAL_DB_NAME } from '../../lib/localDb';
import { applyServerCompletion, applyServerHabit } from '../../lib/localHabits';
import { setOnlineStatus } from '../../lib/network';
import * as pushTokensApi from '../../lib/pushTokens';
import { addDays, todayLocalISO } from '../../lib/streaks';
import { Habit, HabitCompletion } from '../../types';
import { useGroupsStore } from '../groups';
import { resetPublishedActivityEvents, useHabitsStore } from '../habits';

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
}));

jest.mock('../../lib/pushTokens', () => ({
  listGroupPeerTokens: jest.fn(),
  deleteInvalidTokens: jest.fn(),
}));

jest.mock('../../lib/expoPush', () => ({
  sendExpoPushMessages: jest.fn(),
}));

jest.mock('../../lib/habitReminders', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  reconcileHabitReminders: jest.fn(),
}));

// The store reads the signed-in user for mutations and the profile for the
// push copy ("Alice broke a streak").
jest.mock('../auth', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 'user-1' }, profile: { display_name: 'Alice' } }),
  },
}));

const mockedApi = habitsApi as jest.Mocked<typeof habitsApi>;
const mockedActivityApi = activityApi as jest.Mocked<typeof activityApi>;
const mockedPushTokens = pushTokensApi as jest.Mocked<typeof pushTokensApi>;
const mockedExpoPush = expoPushApi as jest.Mocked<typeof expoPushApi>;
const mockedReminders = habitRemindersApi as jest.Mocked<typeof habitRemindersApi>;

const today = todayLocalISO();
const daysAgo = (days: number) => addDays(today, -days);

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

function makeCompletion(overrides: Partial<HabitCompletion> = {}): HabitCompletion {
  return {
    id: 'completion-1',
    habit_id: 'habit-1',
    user_id: 'user-1',
    completed_on: today,
    created_at: '2026-07-02T12:00:00.000Z',
    updated_at: '2026-07-02T12:00:00.000Z',
    ...overrides,
  };
}

function seedSyncedHabit(habit: Habit): void {
  applyServerHabit(habit);
  useHabitsStore.setState((state) => ({ habits: [...state.habits, habit] }));
}

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

/** Seeds a 4-day run ending yesterday: today's toggle lands streak 5 (a milestone). */
function seedFourDayRun(): void {
  seedSyncedHabit(makeHabit());
  seedSyncedCompletions('habit-1', [daysAgo(4), daysAgo(3), daysAgo(2), daysAgo(1)]);
}

/** The publish path chains several promises; one setImmediate is not enough. */
async function flush(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

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
  mockedPushTokens.listGroupPeerTokens.mockResolvedValue(['tok-peer-1']);
  mockedPushTokens.deleteInvalidTokens.mockResolvedValue(undefined);
  mockedExpoPush.sendExpoPushMessages.mockResolvedValue({ tickets: [], invalidTokens: [] });
  mockedReminders.scheduleHabitReminder.mockResolvedValue(undefined);
  mockedReminders.cancelHabitReminder.mockResolvedValue(undefined);
  mockedReminders.reconcileHabitReminders.mockResolvedValue(undefined);
  resetPublishedActivityEvents();
});

describe('social pushes — who gets one and when', () => {
  it('a solo user (zero groups) never even looks up peer tokens', async () => {
    seedFourDayRun();

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedPushTokens.listGroupPeerTokens).not.toHaveBeenCalled();
    expect(mockedExpoPush.sendExpoPushMessages).not.toHaveBeenCalled();
  });

  it('a group where the acting user is the only member sends nothing', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-solo', 1)] });
    seedFourDayRun();

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedPushTokens.listGroupPeerTokens).not.toHaveBeenCalled();
    expect(mockedExpoPush.sendExpoPushMessages).not.toHaveBeenCalled();
  });

  it('an ordinary check-in (streak not a multiple of 5) publishes the feed event but NO push', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', [daysAgo(1)]);

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    // streak_continued with current_streak 2: feed yes, push no.
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'streak_continued' }),
      }),
    );
    expect(mockedExpoPush.sendExpoPushMessages).not.toHaveBeenCalled();
  });

  it('a milestone check-in (multiple of 5) sends exactly one message per qualifying peer token', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    mockedPushTokens.listGroupPeerTokens.mockResolvedValue(['tok-peer-1', 'tok-peer-2']);
    seedFourDayRun();

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedPushTokens.listGroupPeerTokens).toHaveBeenCalledWith('user-1', 'group-1');
    expect(mockedExpoPush.sendExpoPushMessages).toHaveBeenCalledTimes(1);
    const [messages] = mockedExpoPush.sendExpoPushMessages.mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.to).sort()).toEqual(['tok-peer-1', 'tok-peer-2']);
    for (const message of messages) {
      expect(message.title).toContain('Alice');
      expect(message.body).toContain('5-day');
      expect(message.body).toContain('Read');
      expect(message.data).toEqual({ type: 'streak_continued', habit_id: 'habit-1' });
    }
  });

  it('a broken streak always pushes, regardless of the milestone rule', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    seedSyncedHabit(makeHabit());
    // 3-day run that ended three days ago: today's check-in observes the
    // break (previous_streak 3 — NOT a multiple of 5) and restarts at 1
    // (also not a milestone).
    seedSyncedCompletions('habit-1', [daysAgo(5), daysAgo(4), daysAgo(3)]);

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedExpoPush.sendExpoPushMessages).toHaveBeenCalledTimes(1);
    const [messages] = mockedExpoPush.sendExpoPushMessages.mock.calls[0];
    // Only the streak_broken event is push-worthy; the accompanying
    // streak_continued (current 1) must not add messages.
    expect(messages).toHaveLength(1);
    expect(messages[0].title).toContain('Alice');
    expect(messages[0].title).toContain('broke');
    expect(messages[0].body).toContain('3-day');
    expect(messages[0].data).toEqual({ type: 'streak_broken', habit_id: 'habit-1' });
  });

  it('habit_created lands in the feed but never pushes (documented scope choice)', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });

    await useHabitsStore.getState().create(INPUT);
    await flush();

    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ type: 'habit_created' }) }),
    );
    expect(mockedExpoPush.sendExpoPushMessages).not.toHaveBeenCalled();
  });

  it('a peer sharing two groups with the actor gets ONE push, not two (token dedupe)', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2), makeGroup('group-2', 3)] });
    // The same device token shows up through both groups; group-2 adds one
    // more distinct peer.
    mockedPushTokens.listGroupPeerTokens.mockImplementation(async (_userId, groupId) =>
      groupId === 'group-1' ? ['tok-shared'] : ['tok-shared', 'tok-other'],
    );
    seedFourDayRun();

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    const [messages] = mockedExpoPush.sendExpoPushMessages.mock.calls[0];
    expect(messages.map((message) => message.to).sort()).toEqual(['tok-other', 'tok-shared']);
  });

  it('waits for the sync drain to confirm before sending, like the feed events', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    seedFourDayRun();
    let releaseServerToggle!: () => void;
    mockedApi.toggleCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseServerToggle = () => resolve(undefined);
        }),
    );

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    // Server write still in flight: no event row, no push.
    expect(mockedActivityApi.insertActivityEvent).not.toHaveBeenCalled();
    expect(mockedExpoPush.sendExpoPushMessages).not.toHaveBeenCalled();

    releaseServerToggle();
    await flush();
    expect(mockedExpoPush.sendExpoPushMessages).toHaveBeenCalledTimes(1);
  });
});

describe('social pushes — dedup and cleanup', () => {
  it('toggling the same habit/date on/off/on sends at most one push (session dedup key)', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    seedFourDayRun();

    await useHabitsStore.getState().toggle('habit-1');
    await flush();
    await useHabitsStore.getState().toggle('habit-1');
    await flush();
    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    // Same dedup key as the activity event (type:habit:date): the second
    // "on" re-detects the same milestone but must not re-push it.
    expect(mockedActivityApi.insertActivityEvent).toHaveBeenCalledTimes(1);
    expect(mockedExpoPush.sendExpoPushMessages).toHaveBeenCalledTimes(1);
  });

  it('offline on/off/on cycles then a sync still produce at most one push for the dedup key', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    seedFourDayRun();
    setOnlineStatus(false);

    await useHabitsStore.getState().toggle('habit-1');
    await flush();
    await useHabitsStore.getState().toggle('habit-1');
    await flush();
    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    setOnlineStatus(true);
    await useHabitsStore.getState().syncNow();
    await flush();

    expect(mockedExpoPush.sendExpoPushMessages.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('a DeviceNotRegistered receipt deletes that token and never fails the toggle', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    mockedPushTokens.listGroupPeerTokens.mockResolvedValue(['tok-live', 'tok-dead']);
    mockedExpoPush.sendExpoPushMessages.mockResolvedValue({
      tickets: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }],
      invalidTokens: ['tok-dead'],
    });
    seedFourDayRun();

    const result = await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(result.error).toBeNull();
    expect(mockedPushTokens.deleteInvalidTokens).toHaveBeenCalledWith(['tok-dead']);
  });

  it('a push pipeline failure is invisible to the mutation', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    mockedExpoPush.sendExpoPushMessages.mockRejectedValue(new Error('Network request failed'));
    seedFourDayRun();

    const result = await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(result.error).toBeNull();
    expect(useHabitsStore.getState().completions['habit-1']).toContain(today);
  });

  it('a token lookup failure is invisible to the mutation too', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup('group-1', 2)] });
    mockedPushTokens.listGroupPeerTokens.mockRejectedValue(new Error('Network request failed'));
    seedFourDayRun();

    const result = await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(result.error).toBeNull();
    expect(mockedExpoPush.sendExpoPushMessages).not.toHaveBeenCalled();
  });
});

describe('reminder wiring in the habit flows', () => {
  it('completing a habit reschedules its reminder from the new completion state', async () => {
    seedSyncedHabit(makeHabit());

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedReminders.scheduleHabitReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'habit-1' }),
      [today],
    );
  });

  it('unchecking passes the state without today, bringing the reminder back', async () => {
    seedSyncedHabit(makeHabit());
    seedSyncedCompletions('habit-1', [daysAgo(1), today]);

    await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(mockedReminders.scheduleHabitReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'habit-1' }),
      [daysAgo(1)],
    );
  });

  it('creating a habit schedules its reminder immediately (the lib skips weekly ones)', async () => {
    await useHabitsStore.getState().create(INPUT);
    await flush();

    const [createdHabit] = useHabitsStore.getState().habits;
    expect(mockedReminders.scheduleHabitReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: createdHabit.id, frequency: 'daily' }),
      [],
    );
  });

  it('editing a habit reschedules with the edited fields (covers daily→weekly switches)', async () => {
    seedSyncedHabit(makeHabit());
    mockedApi.getHabit.mockResolvedValue(makeHabit());

    await useHabitsStore
      .getState()
      .update('habit-1', { frequency: 'weekly', target_days_per_week: 3 });
    await flush();

    expect(mockedReminders.scheduleHabitReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'habit-1', frequency: 'weekly' }),
      [],
    );
  });

  it('deleting a habit cancels its reminder', async () => {
    seedSyncedHabit(makeHabit());

    await useHabitsStore.getState().remove('habit-1');
    await flush();

    expect(mockedReminders.cancelHabitReminder).toHaveBeenCalledWith('habit-1');
  });

  it('app launch reconciles the schedule against the freshly synced habit list', async () => {
    const serverHabits = [makeHabit(), makeHabit({ id: 'habit-2', name: 'Run' })];
    mockedApi.listHabits.mockResolvedValue(serverHabits);
    mockedApi.listCompletions.mockResolvedValue([makeCompletion({ completed_on: daysAgo(1) })]);

    await useHabitsStore.getState().load();
    await flush();

    expect(mockedReminders.reconcileHabitReminders).toHaveBeenCalledWith(
      useHabitsStore.getState().habits,
      useHabitsStore.getState().completions,
    );
  });

  it('a scheduling failure never fails the toggle', async () => {
    mockedReminders.scheduleHabitReminder.mockRejectedValue(new Error('scheduler down'));
    seedSyncedHabit(makeHabit());

    const result = await useHabitsStore.getState().toggle('habit-1');
    await flush();

    expect(result.error).toBeNull();
    expect(useHabitsStore.getState().completions['habit-1']).toEqual([today]);
  });
});
