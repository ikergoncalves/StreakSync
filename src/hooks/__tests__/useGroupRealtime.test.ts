import { renderHook } from '@testing-library/react-native';

import * as groupsApi from '../../lib/groups';
import { supabase } from '../../lib/supabase';
import { useGroupsStore } from '../../store/groups';
import { ActivityEvent } from '../../types';
import { useGroupRealtime } from '../useGroupRealtime';

jest.mock('../../lib/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock('../../lib/groups', () => ({
  listMyGroups: jest.fn(),
  createGroup: jest.fn(),
  joinGroupByInviteCode: jest.fn(),
  listGroupMembers: jest.fn(),
  listMemberHabitData: jest.fn(),
  leaveGroup: jest.fn(),
}));

jest.mock('../../lib/activity', () => ({
  listActivityEvents: jest.fn(),
  insertActivityEvent: jest.fn(),
}));

jest.mock('../../store/auth', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

const mockedGroupsApi = groupsApi as jest.Mocked<typeof groupsApi>;
const mockedChannel = supabase.channel as jest.Mock;
const mockedRemoveChannel = supabase.removeChannel as jest.Mock;

type PostgresChangesHandler = (payload: { new: ActivityEvent }) => void;

interface MockChannel {
  on: jest.Mock;
  subscribe: jest.Mock;
}

function makeChannel(): MockChannel {
  const channel: MockChannel = {
    on: jest.fn(),
    subscribe: jest.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return channel;
}

function makeEvent(id: string): ActivityEvent {
  return {
    id,
    group_id: 'group-1',
    user_id: 'user-2',
    type: 'member_joined',
    payload: {},
    created_at: '2026-07-03T10:00:00Z',
  };
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
  mockedGroupsApi.listGroupMembers.mockResolvedValue([]);
  mockedGroupsApi.listMemberHabitData.mockResolvedValue({ habits: [], completions: [] });
});

describe('useGroupRealtime', () => {
  it('subscribes to activity_events inserts filtered by the group', async () => {
    const channel = makeChannel();
    mockedChannel.mockReturnValue(channel);

    await renderHook(() => useGroupRealtime('group-1'));

    expect(mockedChannel).toHaveBeenCalledWith('group-activity-group-1');
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        table: 'activity_events',
        filter: 'group_id=eq.group-1',
      }),
      expect.any(Function),
    );
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an active group', async () => {
    await renderHook(() => useGroupRealtime(null));

    expect(mockedChannel).not.toHaveBeenCalled();
  });

  it('prepends incoming events to the feed and refetches members', async () => {
    const channel = makeChannel();
    mockedChannel.mockReturnValue(channel);
    useGroupsStore.setState({ eventsByGroup: { 'group-1': [] } });

    await renderHook(() => useGroupRealtime('group-1'));
    const handler = channel.on.mock.calls[0][2] as PostgresChangesHandler;
    handler({ new: makeEvent('event-1') });
    handler({ new: makeEvent('event-2') });

    const feed = useGroupsStore.getState().eventsByGroup['group-1'];
    expect(feed.map((event) => event.id)).toEqual(['event-2', 'event-1']);
    // The leaderboard data is refetched wholesale on every event.
    expect(mockedGroupsApi.listGroupMembers).toHaveBeenCalledWith('group-1');
    expect(mockedGroupsApi.listGroupMembers).toHaveBeenCalledTimes(2);
  });

  it('removes the channel on unmount and when the group changes', async () => {
    const first = makeChannel();
    const second = makeChannel();
    mockedChannel.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const { rerender, unmount } = await renderHook(
      ({ groupId }: { groupId: string | null }) => useGroupRealtime(groupId),
      { initialProps: { groupId: 'group-1' } },
    );

    await rerender({ groupId: 'group-2' });
    expect(mockedRemoveChannel).toHaveBeenCalledWith(first);
    expect(mockedChannel).toHaveBeenCalledWith('group-activity-group-2');

    await unmount();
    expect(mockedRemoveChannel).toHaveBeenCalledWith(second);
  });
});
