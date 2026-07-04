import * as activityApi from '../../lib/activity';
import * as groupsApi from '../../lib/groups';
import { addDays, todayLocalISO } from '../../lib/streaks';
import {
  ActivityEvent,
  ActivityEventWithProfile,
  GroupMember,
  Habit,
  HabitCompletion,
  Profile,
} from '../../types';
import { selectLeaderboard, useGroupsStore } from '../groups';

jest.mock('../../lib/groups', () => ({
  listMyGroups: jest.fn(),
  createGroup: jest.fn(),
  joinGroupByInviteCode: jest.fn(),
  listGroupMembers: jest.fn(),
  listMemberHabitData: jest.fn(),
  leaveGroup: jest.fn(),
  deleteGroup: jest.fn(),
}));

jest.mock('../../lib/activity', () => ({
  listActivityEvents: jest.fn(),
  insertActivityEvent: jest.fn(),
}));

// The auth store pulls in the supabase client (which needs env config); the
// groups store only reads the signed-in user from it, so stub the module.
jest.mock('../auth', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

const mockedGroupsApi = groupsApi as jest.Mocked<typeof groupsApi>;
const mockedActivityApi = activityApi as jest.Mocked<typeof activityApi>;

const today = todayLocalISO();
const yesterday = addDays(today, -1);

function makeGroup(
  overrides: Partial<groupsApi.GroupWithMemberCount> = {},
): groupsApi.GroupWithMemberCount {
  return {
    id: 'group-1',
    name: 'Morning crew',
    invite_code: 'A7K2M9XZ',
    owner_id: 'user-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    member_count: 2,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    username: 'alice',
    display_name: 'Alice',
    avatar_url: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeMember(userId: string, username: string): GroupMember {
  return {
    group_id: 'group-1',
    user_id: userId,
    role: userId === 'user-1' ? 'owner' : 'member',
    joined_at: '2026-07-01T00:00:00Z',
    profile: makeProfile({
      id: userId,
      username,
      display_name: username.charAt(0).toUpperCase() + username.slice(1),
    }),
  };
}

function makeHabit(id: string, userId: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id,
    user_id: userId,
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

function makeCompletion(habitId: string, userId: string, date: string): HabitCompletion {
  return {
    id: `${habitId}-${date}`,
    habit_id: habitId,
    user_id: userId,
    completed_on: date,
    created_at: `${date}T12:00:00Z`,
    updated_at: `${date}T12:00:00Z`,
  };
}

function makeEvent(overrides: Partial<ActivityEventWithProfile> = {}): ActivityEventWithProfile {
  return {
    id: 'event-1',
    group_id: 'group-1',
    user_id: 'user-2',
    type: 'member_joined',
    payload: {},
    created_at: '2026-07-03T10:00:00Z',
    profile: null,
    ...overrides,
  } as ActivityEventWithProfile;
}

beforeEach(() => {
  jest.clearAllMocks();
  useGroupsStore.setState({
    myGroups: [],
    activeGroupId: null,
    membersByGroup: {},
    memberHabitsByGroup: {},
    memberCompletionsByGroup: {},
    eventsByGroup: {},
    isLoading: false,
    isRefreshing: false,
    error: null,
  });
});

describe('loadGroups', () => {
  it('populates groups and selects the first when nothing is active', async () => {
    const groups = [makeGroup(), makeGroup({ id: 'group-2', name: 'Runners' })];
    mockedGroupsApi.listMyGroups.mockResolvedValue(groups);

    await useGroupsStore.getState().loadGroups();

    const state = useGroupsStore.getState();
    expect(state.myGroups).toEqual(groups);
    expect(state.activeGroupId).toBe('group-1');
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('keeps the current selection when it still exists', async () => {
    useGroupsStore.setState({ activeGroupId: 'group-2' });
    mockedGroupsApi.listMyGroups.mockResolvedValue([
      makeGroup(),
      makeGroup({ id: 'group-2', name: 'Runners' }),
    ]);

    await useGroupsStore.getState().loadGroups();

    expect(useGroupsStore.getState().activeGroupId).toBe('group-2');
  });

  it('records an error message when loading fails', async () => {
    mockedGroupsApi.listMyGroups.mockRejectedValue(new Error('Network request failed'));

    await useGroupsStore.getState().loadGroups();

    const state = useGroupsStore.getState();
    expect(state.error).toMatch(/connection/i);
    expect(state.isLoading).toBe(false);
  });
});

describe('create', () => {
  it('appends the group with a member count of one and makes it active', async () => {
    const group = makeGroup();
    mockedGroupsApi.createGroup.mockResolvedValue(group);

    const result = await useGroupsStore.getState().create('Morning crew');

    expect(result.error).toBeNull();
    expect(mockedGroupsApi.createGroup).toHaveBeenCalledWith('user-1', 'Morning crew');
    const state = useGroupsStore.getState();
    expect(state.myGroups).toEqual([{ ...group, member_count: 1 }]);
    expect(state.activeGroupId).toBe('group-1');
  });

  it('returns an error and leaves state unchanged on failure', async () => {
    mockedGroupsApi.createGroup.mockRejectedValue(new Error('Network request failed'));

    const result = await useGroupsStore.getState().create('Morning crew');

    expect(result.error).toMatch(/connection/i);
    expect(useGroupsStore.getState().myGroups).toEqual([]);
  });
});

describe('joinByCode', () => {
  it('joins, selects the group, and refreshes the list from the server', async () => {
    const group = makeGroup();
    mockedGroupsApi.joinGroupByInviteCode.mockResolvedValue({ group, alreadyMember: false });
    mockedGroupsApi.listMyGroups.mockResolvedValue([{ ...group, member_count: 3 }]);

    const result = await useGroupsStore.getState().joinByCode('a7k2m9xz');

    expect(result.error).toBeNull();
    expect(result.alreadyMember).toBe(false);
    expect(mockedGroupsApi.joinGroupByInviteCode).toHaveBeenCalledWith('a7k2m9xz');
    const state = useGroupsStore.getState();
    expect(state.activeGroupId).toBe('group-1');
    expect(state.myGroups).toEqual([{ ...group, member_count: 3 }]);
  });

  it('reports an existing membership without duplicating the group', async () => {
    const group = makeGroup();
    useGroupsStore.setState({
      myGroups: [{ ...group, member_count: 3 }],
      activeGroupId: 'group-2',
    });
    mockedGroupsApi.joinGroupByInviteCode.mockResolvedValue({ group, alreadyMember: true });
    mockedGroupsApi.listMyGroups.mockResolvedValue([{ ...group, member_count: 3 }]);

    const result = await useGroupsStore.getState().joinByCode('A7K2M9XZ');

    expect(result).toEqual({ error: null, alreadyMember: true });
    const state = useGroupsStore.getState();
    // Not an error: the group is simply selected instead of added twice.
    expect(state.myGroups).toHaveLength(1);
    expect(state.activeGroupId).toBe('group-1');
  });

  it('surfaces the error for an invalid code', async () => {
    mockedGroupsApi.joinGroupByInviteCode.mockRejectedValue(
      new Error('Invalid invite code. Double-check it and try again.'),
    );

    const result = await useGroupsStore.getState().joinByCode('WRONG123');

    expect(result.error).toMatch(/invalid invite code/i);
    expect(result.alreadyMember).toBe(false);
    expect(useGroupsStore.getState().myGroups).toEqual([]);
    expect(mockedGroupsApi.listMyGroups).not.toHaveBeenCalled();
  });
});

describe('leave', () => {
  it('removes the group and its cached data, moving the selection', async () => {
    useGroupsStore.setState({
      myGroups: [makeGroup(), makeGroup({ id: 'group-2', name: 'Runners' })],
      activeGroupId: 'group-1',
      membersByGroup: { 'group-1': [makeMember('user-1', 'alice')] },
      eventsByGroup: { 'group-1': [makeEvent()] },
    });
    mockedGroupsApi.leaveGroup.mockResolvedValue(undefined);

    const result = await useGroupsStore.getState().leave('group-1');

    expect(result.error).toBeNull();
    expect(mockedGroupsApi.leaveGroup).toHaveBeenCalledWith('group-1', 'user-1');
    const state = useGroupsStore.getState();
    expect(state.myGroups.map((group) => group.id)).toEqual(['group-2']);
    expect(state.activeGroupId).toBe('group-2');
    expect(state.membersByGroup['group-1']).toBeUndefined();
    expect(state.eventsByGroup['group-1']).toBeUndefined();
  });

  it('blocks a sole owner and keeps the group', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup()], activeGroupId: 'group-1' });
    mockedGroupsApi.leaveGroup.mockRejectedValue(
      new Error('You are the only owner of this group.'),
    );

    const result = await useGroupsStore.getState().leave('group-1');

    expect(result.error).toMatch(/only owner/i);
    expect(useGroupsStore.getState().myGroups).toHaveLength(1);
    expect(useGroupsStore.getState().activeGroupId).toBe('group-1');
  });
});

describe('deleteGroup', () => {
  it('removes the group and its cached data, moving the selection', async () => {
    useGroupsStore.setState({
      myGroups: [makeGroup(), makeGroup({ id: 'group-2', name: 'Runners' })],
      activeGroupId: 'group-1',
      membersByGroup: { 'group-1': [makeMember('user-1', 'alice')] },
      memberHabitsByGroup: { 'group-1': [makeHabit('habit-1', 'user-1')] },
      memberCompletionsByGroup: { 'group-1': [makeCompletion('habit-1', 'user-1', today)] },
      eventsByGroup: { 'group-1': [makeEvent()] },
    });
    mockedGroupsApi.deleteGroup.mockResolvedValue(undefined);

    const result = await useGroupsStore.getState().deleteGroup('group-1');

    expect(result.error).toBeNull();
    expect(mockedGroupsApi.deleteGroup).toHaveBeenCalledWith('group-1');
    const state = useGroupsStore.getState();
    expect(state.myGroups.map((group) => group.id)).toEqual(['group-2']);
    expect(state.activeGroupId).toBe('group-2');
    expect(state.membersByGroup['group-1']).toBeUndefined();
    expect(state.memberHabitsByGroup['group-1']).toBeUndefined();
    expect(state.memberCompletionsByGroup['group-1']).toBeUndefined();
    expect(state.eventsByGroup['group-1']).toBeUndefined();
  });

  it('returns an error and keeps the group when the delete fails', async () => {
    useGroupsStore.setState({ myGroups: [makeGroup()], activeGroupId: 'group-1' });
    mockedGroupsApi.deleteGroup.mockRejectedValue(new Error('Network request failed'));

    const result = await useGroupsStore.getState().deleteGroup('group-1');

    expect(result.error).toMatch(/connection/i);
    expect(useGroupsStore.getState().myGroups).toHaveLength(1);
    expect(useGroupsStore.getState().activeGroupId).toBe('group-1');
  });
});

describe('loadMembers', () => {
  it('stores members and their habit data for the leaderboard', async () => {
    const members = [makeMember('user-1', 'alice'), makeMember('user-2', 'bob')];
    const habits = [makeHabit('habit-1', 'user-1')];
    const completions = [makeCompletion('habit-1', 'user-1', today)];
    mockedGroupsApi.listGroupMembers.mockResolvedValue(members);
    mockedGroupsApi.listMemberHabitData.mockResolvedValue({ habits, completions });

    await useGroupsStore.getState().loadMembers('group-1');

    expect(mockedGroupsApi.listMemberHabitData).toHaveBeenCalledWith(['user-1', 'user-2']);
    const state = useGroupsStore.getState();
    expect(state.membersByGroup['group-1']).toEqual(members);
    expect(state.memberHabitsByGroup['group-1']).toEqual(habits);
    expect(state.memberCompletionsByGroup['group-1']).toEqual(completions);
    expect(state.isRefreshing).toBe(false);
  });
});

describe('loadActivity', () => {
  it('stores the feed for the group', async () => {
    const events = [makeEvent(), makeEvent({ id: 'event-2' })];
    mockedActivityApi.listActivityEvents.mockResolvedValue(events);

    await useGroupsStore.getState().loadActivity('group-1');

    expect(useGroupsStore.getState().eventsByGroup['group-1']).toEqual(events);
  });
});

describe('ingestRealtimeEvent', () => {
  it('prepends a new event and resolves the actor from loaded members', async () => {
    useGroupsStore.setState({
      membersByGroup: { 'group-1': [makeMember('user-2', 'bob')] },
      eventsByGroup: { 'group-1': [makeEvent()] },
    });

    // Realtime rows carry no profile; the store must resolve it from members.
    const incoming: ActivityEvent = makeEvent({ id: 'event-2', user_id: 'user-2', profile: null });
    useGroupsStore.getState().ingestRealtimeEvent(incoming);

    const feed = useGroupsStore.getState().eventsByGroup['group-1'];
    expect(feed.map((event) => event.id)).toEqual(['event-2', 'event-1']);
    expect(feed[0].profile?.username).toBe('bob');
  });

  it('ignores an event that is already in the feed', () => {
    useGroupsStore.setState({ eventsByGroup: { 'group-1': [makeEvent()] } });

    useGroupsStore.getState().ingestRealtimeEvent(makeEvent());

    expect(useGroupsStore.getState().eventsByGroup['group-1']).toHaveLength(1);
  });
});

describe('patchOwnCompletionData', () => {
  it("replaces only the user's own rows in every cached group, without refetching", () => {
    const ownHabit = makeHabit('habit-1', 'user-1');
    const peerHabit = makeHabit('habit-2', 'user-2');
    const ownOldCompletion = makeCompletion('habit-1', 'user-1', yesterday);
    const peerCompletion = makeCompletion('habit-2', 'user-2', today);
    useGroupsStore.setState({
      memberHabitsByGroup: { 'group-1': [ownHabit, peerHabit], 'group-2': [peerHabit] },
      memberCompletionsByGroup: {
        'group-1': [ownOldCompletion, peerCompletion],
        'group-2': [peerCompletion],
      },
    });

    useGroupsStore.getState().patchOwnCompletionData('user-1', ownHabit, [yesterday, today]);

    const state = useGroupsStore.getState();
    expect(
      state.memberCompletionsByGroup['group-1']
        .filter((completion) => completion.habit_id === 'habit-1')
        .map((completion) => completion.completed_on),
    ).toEqual([yesterday, today]);
    // The peer's rows are untouched in both groups.
    expect(state.memberCompletionsByGroup['group-1']).toContainEqual(peerCompletion);
    expect(state.memberHabitsByGroup['group-1']).toContainEqual(peerHabit);
    // group-2 had no cached copy of this habit yet: it gains one.
    expect(state.memberHabitsByGroup['group-2']).toContainEqual(ownHabit);
    expect(
      state.memberCompletionsByGroup['group-2'].filter(
        (completion) => completion.habit_id === 'habit-1',
      ),
    ).toHaveLength(2);
    // Local patch only — the Realtime/pull-to-refresh paths own refetching.
    expect(mockedGroupsApi.listGroupMembers).not.toHaveBeenCalled();
    expect(mockedGroupsApi.listMemberHabitData).not.toHaveBeenCalled();
  });

  it('is a no-op when no group data is cached', () => {
    useGroupsStore
      .getState()
      .patchOwnCompletionData('user-1', makeHabit('habit-1', 'user-1'), [today]);

    expect(useGroupsStore.getState().memberHabitsByGroup).toEqual({});
    expect(useGroupsStore.getState().memberCompletionsByGroup).toEqual({});
  });
});

describe('selectLeaderboard', () => {
  it('ranks by summed current streaks, breaking ties alphabetically', () => {
    const state = {
      membersByGroup: {
        'group-1': [
          makeMember('user-3', 'carol'),
          makeMember('user-2', 'bob'),
          makeMember('user-1', 'alice'),
        ],
      },
      memberHabitsByGroup: {
        'group-1': [
          // Alice: one daily habit on a 2-day streak -> 2.
          makeHabit('habit-1', 'user-1'),
          // Bob: a 1-day daily streak plus a weekly habit whose week is met
          // -> 2 total; ties with Alice and loses alphabetically.
          makeHabit('habit-2', 'user-2'),
          makeHabit('habit-3', 'user-2', { frequency: 'weekly', target_days_per_week: 1 }),
          // Carol: only a deleted habit; its completions must not count.
          makeHabit('habit-4', 'user-3', { deleted_at: '2026-07-01T00:00:00Z' }),
        ],
      },
      memberCompletionsByGroup: {
        'group-1': [
          makeCompletion('habit-1', 'user-1', yesterday),
          makeCompletion('habit-1', 'user-1', today),
          makeCompletion('habit-2', 'user-2', today),
          makeCompletion('habit-3', 'user-2', today),
          makeCompletion('habit-4', 'user-3', today),
        ],
      },
    };

    const leaderboard = selectLeaderboard(state, 'group-1', today);

    expect(leaderboard.map((entry) => [entry.username, entry.totalStreak])).toEqual([
      ['alice', 2],
      ['bob', 2],
      ['carol', 0],
    ]);
  });

  it('returns an empty list for a group without loaded members', () => {
    expect(
      selectLeaderboard(
        { membersByGroup: {}, memberHabitsByGroup: {}, memberCompletionsByGroup: {} },
        'group-1',
      ),
    ).toEqual([]);
  });
});
