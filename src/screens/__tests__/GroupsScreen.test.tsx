import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { GroupWithMemberCount } from '../../lib/groups';
import { LeaderboardEntry } from '../../store/groups';
import { ActivityEventWithProfile, GroupMember, Profile } from '../../types';
import { GroupsScreen } from '../GroupsScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

// The realtime hook opens a supabase channel; its behavior is covered by its
// own test, so a no-op keeps this a pure render test.
jest.mock('../../hooks/useGroupRealtime', () => ({
  useGroupRealtime: jest.fn(),
}));

// Connectivity is faked per test: the groups screen is online-only by the
// Phase 4 scope decision, so offline it must show a dedicated state instead
// of stale social data.
let mockIsOnline = true;
jest.mock('../../hooks/useIsOnline', () => ({
  useIsOnline: () => mockIsOnline,
  useNetworkStatusMonitor: jest.fn(),
}));

// The screen only reads the signed-in user's id (for the sole-owner check);
// the real auth store would drag in the supabase client.
jest.mock('../../store/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'user-1' } }),
}));

interface MockState {
  myGroups: GroupWithMemberCount[];
  activeGroupId: string | null;
  membersByGroup: Record<string, GroupMember[]>;
  memberHabitsByGroup: Record<string, unknown[]>;
  memberCompletionsByGroup: Record<string, unknown[]>;
  eventsByGroup: Record<string, ActivityEventWithProfile[]>;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  loadGroups: jest.Mock;
  selectGroup: jest.Mock;
  create: jest.Mock;
  joinByCode: jest.Mock;
  leave: jest.Mock;
  deleteGroup: jest.Mock;
  loadMembers: jest.Mock;
  loadActivity: jest.Mock;
  ingestRealtimeEvent: jest.Mock;
}

let mockState: MockState;
const mockSelectLeaderboard = jest.fn<LeaderboardEntry[], unknown[]>();

// The screen reads everything through useGroupsStore selectors and derives
// the leaderboard via selectLeaderboard (ranking logic is covered by the
// store tests), so a selector-over-object stub is enough.
jest.mock('../../store/groups', () => ({
  useGroupsStore: (selector: (state: MockState) => unknown) => selector(mockState),
  selectLeaderboard: (...args: unknown[]) => mockSelectLeaderboard(...args),
}));

function makeGroup(overrides: Partial<GroupWithMemberCount> = {}): GroupWithMemberCount {
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

function makeEntry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    userId: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    role: 'owner',
    totalStreak: 0,
    ...overrides,
  };
}

function makeProfile(id: string, username: string, displayName: string): Profile {
  return {
    id,
    username,
    display_name: displayName,
    avatar_url: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  };
}

function makeMember(userId: string, role: GroupMember['role']): GroupMember {
  return {
    group_id: 'group-1',
    user_id: userId,
    role,
    joined_at: '2026-07-01T00:00:00Z',
    profile: makeProfile(userId, `user${userId}`, `User ${userId}`),
  };
}

type ScreenProps = Parameters<typeof GroupsScreen>[0];

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as ScreenProps['navigation'];

const route = { key: 'Groups-1', name: 'Groups' } as ScreenProps['route'];

function renderScreen() {
  return render(<GroupsScreen navigation={navigation} route={route} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnline = true;
  mockSelectLeaderboard.mockReturnValue([]);
  mockState = {
    myGroups: [],
    activeGroupId: null,
    membersByGroup: {},
    memberHabitsByGroup: {},
    memberCompletionsByGroup: {},
    eventsByGroup: {},
    isLoading: false,
    isRefreshing: false,
    error: null,
    loadGroups: jest.fn().mockResolvedValue(undefined),
    selectGroup: jest.fn(),
    create: jest.fn(),
    joinByCode: jest.fn(),
    leave: jest.fn(),
    deleteGroup: jest.fn(),
    loadMembers: jest.fn().mockResolvedValue(undefined),
    loadActivity: jest.fn().mockResolvedValue(undefined),
    ingestRealtimeEvent: jest.fn(),
  };
});

describe('GroupsScreen', () => {
  it('loads groups on mount', async () => {
    await renderScreen();

    expect(mockState.loadGroups).toHaveBeenCalledTimes(1);
  });

  it('shows the offline state and attempts no network calls while offline', async () => {
    mockIsOnline = false;
    mockState.myGroups = [makeGroup()];
    mockState.activeGroupId = 'group-1';

    await renderScreen();

    expect(screen.getByTestId('groups-offline')).toBeTruthy();
    expect(mockState.loadGroups).not.toHaveBeenCalled();
    expect(mockState.loadMembers).not.toHaveBeenCalled();
    expect(mockState.loadActivity).not.toHaveBeenCalled();
    // Cached social data is hidden rather than presented as if it were live.
    expect(screen.queryByText('A7K2M9XZ')).toBeNull();
  });

  it('tears down the realtime subscription while offline', async () => {
    const { useGroupRealtime } = jest.requireMock<{
      useGroupRealtime: jest.Mock;
    }>('../../hooks/useGroupRealtime');
    mockIsOnline = false;
    mockState.myGroups = [makeGroup()];
    mockState.activeGroupId = 'group-1';

    await renderScreen();

    expect(useGroupRealtime).toHaveBeenCalledWith(null);
  });

  it('shows the empty state with create and join CTAs when the user has no groups', async () => {
    await renderScreen();

    expect(screen.getByTestId('groups-empty-state')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('create-group-cta'));
    expect(navigation.navigate).toHaveBeenCalledWith('CreateGroup');

    await fireEvent.press(screen.getByTestId('join-group-cta'));
    expect(navigation.navigate).toHaveBeenCalledWith('JoinGroup');
  });

  it('loads members and the feed for the active group', async () => {
    mockState.myGroups = [makeGroup()];
    mockState.activeGroupId = 'group-1';

    await renderScreen();

    expect(mockState.loadMembers).toHaveBeenCalledWith('group-1');
    expect(mockState.loadActivity).toHaveBeenCalledWith('group-1');
  });

  it('renders the leaderboard in the order the selector ranks', async () => {
    mockState.myGroups = [makeGroup()];
    mockState.activeGroupId = 'group-1';
    mockSelectLeaderboard.mockReturnValue([
      makeEntry({ userId: 'user-2', username: 'bob', displayName: 'Bob', totalStreak: 7 }),
      makeEntry({ userId: 'user-1', username: 'alice', displayName: 'Alice', totalStreak: 4 }),
    ]);

    await renderScreen();

    expect(within(screen.getByTestId('leaderboard-row-1')).getByText('Bob')).toBeTruthy();
    expect(within(screen.getByTestId('leaderboard-row-1')).getByText('🔥 7')).toBeTruthy();
    expect(within(screen.getByTestId('leaderboard-row-2')).getByText('Alice')).toBeTruthy();
  });

  it('renders the activity feed with a message per event', async () => {
    mockState.myGroups = [makeGroup()];
    mockState.activeGroupId = 'group-1';
    mockState.eventsByGroup = {
      'group-1': [
        {
          id: 'event-1',
          group_id: 'group-1',
          user_id: 'user-2',
          type: 'streak_continued',
          payload: {
            habit_id: 'habit-1',
            habit_name: 'Read',
            habit_icon: '📚',
            frequency: 'daily',
            current_streak: 2,
            event_date: '2026-07-04',
          },
          created_at: new Date().toISOString(),
          profile: makeProfile('user-2', 'bob', 'Bob'),
        },
        {
          id: 'event-2',
          group_id: 'group-1',
          user_id: 'user-1',
          type: 'member_joined',
          payload: {},
          created_at: new Date().toISOString(),
          profile: makeProfile('user-1', 'alice', 'Alice'),
        },
      ],
    };

    await renderScreen();

    expect(screen.getByText('Bob is on a 2-day streak with "Read"')).toBeTruthy();
    expect(screen.getByText('Alice joined the group')).toBeTruthy();
  });

  it('shows the invite code for the active group', async () => {
    mockState.myGroups = [makeGroup()];
    mockState.activeGroupId = 'group-1';

    await renderScreen();

    expect(screen.getByText('A7K2M9XZ')).toBeTruthy();
  });

  it('switches groups through the selector chips', async () => {
    mockState.myGroups = [makeGroup(), makeGroup({ id: 'group-2', name: 'Runners' })];
    mockState.activeGroupId = 'group-1';

    await renderScreen();
    await fireEvent.press(screen.getByTestId('group-chip-group-2'));

    expect(mockState.selectGroup).toHaveBeenCalledWith('group-2');
  });

  it('offers "Delete group" instead of "Leave" to the sole owner', async () => {
    mockState.myGroups = [makeGroup()];
    mockState.activeGroupId = 'group-1';
    // Signed-in user (user-1, from the auth mock) holds the only owner role.
    mockState.membersByGroup = {
      'group-1': [makeMember('user-1', 'owner'), makeMember('user-2', 'member')],
    };

    await renderScreen();

    expect(screen.getByTestId('delete-group-button')).toBeTruthy();
    expect(screen.getByText('Delete group')).toBeTruthy();
    expect(screen.queryByTestId('leave-group-button')).toBeNull();
  });

  it('offers "Leave" to a regular member', async () => {
    mockState.myGroups = [makeGroup()];
    mockState.activeGroupId = 'group-1';
    mockState.membersByGroup = {
      'group-1': [makeMember('user-2', 'owner'), makeMember('user-1', 'member')],
    };

    await renderScreen();

    expect(screen.getByTestId('leave-group-button')).toBeTruthy();
    expect(screen.queryByTestId('delete-group-button')).toBeNull();
  });
});
