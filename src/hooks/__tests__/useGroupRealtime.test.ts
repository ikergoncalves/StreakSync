import { act, renderHook } from '@testing-library/react-native';

import * as groupsApi from '../../lib/groups';
import { supabase } from '../../lib/supabase';
import { useGroupsStore } from '../../store/groups';
import { ActivityEvent } from '../../types';
import { useGroupRealtime } from '../useGroupRealtime';

jest.mock('../../lib/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn(), getChannels: jest.fn() },
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
const mockedGetChannels = supabase.getChannels as jest.Mock;

type PostgresChangesHandler = (payload: { new: ActivityEvent }) => void;

interface FakeChannel {
  topic: string;
  subscribed: boolean;
  on: jest.Mock;
  subscribe: jest.Mock;
}

// Stateful stand-in for the client's channel registry, mimicking the real
// behavior behind the production crash: channel() returns the EXISTING
// instance for a topic that is still tracked, removeChannel() only untracks
// asynchronously, and .on() after .subscribe() throws. Any test that drives
// the hook into the old double-subscribe bug fails loudly here.
let trackedChannels: FakeChannel[] = [];

function makeChannel(topic: string): FakeChannel {
  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    subscribed: false,
    on: jest.fn(),
    subscribe: jest.fn(),
  };
  channel.on.mockImplementation(() => {
    if (channel.subscribed) {
      throw new Error(
        `cannot add 'postgres_changes' callbacks for ${channel.topic} after 'subscribe()'`,
      );
    }
    return channel;
  });
  channel.subscribe.mockImplementation(() => {
    channel.subscribed = true;
    return channel;
  });
  return channel;
}

/** Flushes the hook's async subscribe flow (stale removal happens first). */
function flush() {
  return act(async () => {});
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

function channelsFor(groupId: string): FakeChannel[] {
  return trackedChannels.filter(
    (channel) => channel.topic === `realtime:group-activity-${groupId}`,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  trackedChannels = [];
  mockedChannel.mockImplementation((topic: string) => {
    const existing = trackedChannels.find((channel) => channel.topic === `realtime:${topic}`);
    if (existing) {
      return existing;
    }
    const created = makeChannel(topic);
    trackedChannels.push(created);
    return created;
  });
  mockedGetChannels.mockImplementation(() => [...trackedChannels]);
  mockedRemoveChannel.mockImplementation((channel: FakeChannel) =>
    // Async like the real client: the channel stays tracked (and would still
    // be returned by channel()) until this promise resolves.
    Promise.resolve().then(() => {
      trackedChannels = trackedChannels.filter((tracked) => tracked !== channel);
    }),
  );
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
    await renderHook(() => useGroupRealtime('group-1'));
    await flush();

    expect(mockedChannel).toHaveBeenCalledWith('group-activity-group-1');
    const [channel] = channelsFor('group-1');
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
    await flush();

    expect(mockedChannel).not.toHaveBeenCalled();
    expect(mockedGetChannels).not.toHaveBeenCalled();
  });

  it('prepends incoming events to the feed and refetches members', async () => {
    useGroupsStore.setState({ eventsByGroup: { 'group-1': [] } });

    await renderHook(() => useGroupRealtime('group-1'));
    await flush();
    const [channel] = channelsFor('group-1');
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
    const { rerender, unmount } = await renderHook(
      ({ groupId }: { groupId: string | null }) => useGroupRealtime(groupId),
      { initialProps: { groupId: 'group-1' } },
    );
    await flush();
    const [first] = channelsFor('group-1');

    await rerender({ groupId: 'group-2' });
    await flush();
    expect(mockedRemoveChannel).toHaveBeenCalledWith(first);
    expect(mockedChannel).toHaveBeenCalledWith('group-activity-group-2');
    const [second] = channelsFor('group-2');

    await unmount();
    await flush();
    expect(mockedRemoveChannel).toHaveBeenCalledWith(second);
  });

  it('survives the effect running twice for the same group before the old channel is gone', async () => {
    // First run subscribes normally.
    await renderHook(() => useGroupRealtime('group-1'));
    await flush();
    const [first] = channelsFor('group-1');
    expect(first.subscribed).toBe(true);

    // Second run for the SAME group while the first channel is still tracked
    // by the client (simulating a double-invoked effect racing the async
    // removal). Before the fix, channel() handed back the already-subscribed
    // instance and .on() threw — the fake channel reproduces that throw.
    await renderHook(() => useGroupRealtime('group-1'));
    await flush();

    // Exactly one live channel remains for the topic, and it is a fresh
    // instance created only after the stale one was removed.
    const remaining = channelsFor('group-1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toBe(first);
    expect(remaining[0].subscribed).toBe(true);
    expect(remaining[0].on).toHaveBeenCalledTimes(1);
    expect(mockedRemoveChannel).toHaveBeenCalledWith(first);
    // The stale channel never had callbacks added after it subscribed.
    expect(first.on).toHaveBeenCalledTimes(1);
  });
});
