import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useGroupRealtime } from '../hooks/useGroupRealtime';
import { GroupWithMemberCount } from '../lib/groups';
import { formatRelativeTime } from '../lib/relativeTime';
import { AppStackParamList, AppTabParamList } from '../navigation/types';
import { LeaderboardEntry, selectLeaderboard, useGroupsStore } from '../store/groups';
import { ActivityEventWithProfile } from '../types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<AppTabParamList, 'Groups'>,
  NativeStackScreenProps<AppStackParamList>
>;

const MONOSPACE = Platform.select({ ios: 'Courier', default: 'monospace' });

const RANK_BADGES = ['🥇', '🥈', '🥉'];

function eventPresentation(event: ActivityEventWithProfile): { icon: string; message: string } {
  const name = event.profile?.display_name ?? 'Someone';
  switch (event.type) {
    case 'streak_continued': {
      const unit = event.payload.frequency === 'weekly' ? 'week' : 'day';
      return {
        icon: '🔥',
        message: `${name} is on a ${event.payload.current_streak}-${unit} streak with "${event.payload.habit_name}"`,
      };
    }
    case 'streak_broken': {
      const unit = event.payload.frequency === 'weekly' ? 'week' : 'day';
      return {
        icon: '💔',
        message: `${name} broke a ${event.payload.previous_streak}-${unit} streak on "${event.payload.habit_name}"`,
      };
    }
    case 'habit_created':
      return { icon: '✨', message: `${name} started a new habit: "${event.payload.habit_name}"` };
    case 'member_joined':
      return { icon: '👋', message: `${name} joined the group` };
  }
}

function GroupSelector({
  groups,
  activeGroupId,
  onSelect,
}: {
  groups: GroupWithMemberCount[];
  activeGroupId: string | null;
  onSelect: (groupId: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mb-4 flex-grow-0"
      contentContainerClassName="gap-2"
    >
      {groups.map((group) => {
        const active = group.id === activeGroupId;
        return (
          <Pressable
            key={group.id}
            testID={`group-chip-${group.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(group.id)}
            className={`rounded-full border px-4 py-2 ${
              active ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 bg-white'
            }`}
          >
            <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-slate-700'}`}>
              {group.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function InviteCard({
  group,
  onLeave,
}: {
  group: GroupWithMemberCount;
  onLeave: (group: GroupWithMemberCount) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    try {
      await Share.share({
        message:
          `Join my group "${group.name}" on StreakSync! ` +
          `Open streaksync://join/${group.invite_code} or enter code ${group.invite_code} in the app.`,
      });
    } catch {
      // The user dismissed the sheet or sharing is unavailable — not an error.
    }
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(group.invite_code);
    setCopied(true);
  };

  return (
    <View className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-xs font-medium uppercase text-slate-400">Invite code</Text>
          <Text
            testID="invite-code"
            className="mt-0.5 text-lg font-bold tracking-widest text-slate-900"
            style={{ fontFamily: MONOSPACE }}
          >
            {group.invite_code}
          </Text>
        </View>
        <Pressable
          testID="copy-code-button"
          accessibilityRole="button"
          accessibilityLabel="Copy invite code"
          onPress={() => void handleCopy()}
          className="rounded-lg bg-slate-100 px-3 py-2 active:bg-slate-200"
        >
          <Text className="text-sm font-medium text-slate-700">{copied ? 'Copied!' : 'Copy'}</Text>
        </Pressable>
      </View>
      <View className="mt-3 flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Button title="Invite friends" onPress={() => void handleShare()} testID="share-button" />
        </View>
        <Pressable
          testID="leave-group-button"
          accessibilityRole="button"
          accessibilityLabel={`Leave ${group.name}`}
          onPress={() => onLeave(group)}
          className="rounded-lg px-3 py-2 active:bg-red-50"
        >
          <Text className="text-sm font-medium text-red-600">Leave</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LeaderboardRow({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  return (
    <View
      testID={`leaderboard-row-${rank}`}
      className="flex-row items-center border-b border-slate-100 py-3 last:border-b-0"
    >
      <Text className="w-9 text-center text-base">{RANK_BADGES[rank - 1] ?? `${rank}`}</Text>
      <View className="ml-2 flex-1">
        <Text className="text-base font-semibold text-slate-900" numberOfLines={1}>
          {entry.displayName}
        </Text>
        <Text className="text-xs text-slate-500">@{entry.username}</Text>
      </View>
      <Text className="text-base font-semibold text-slate-700">🔥 {entry.totalStreak}</Text>
    </View>
  );
}

function FeedRow({ event }: { event: ActivityEventWithProfile }) {
  const { icon, message } = eventPresentation(event);
  return (
    <View testID={`feed-row-${event.id}`} className="mb-3 flex-row rounded-2xl bg-white p-4 shadow-sm">
      <Text className="text-xl">{icon}</Text>
      <View className="ml-3 flex-1">
        <Text className="text-sm text-slate-900">{message}</Text>
        <Text className="mt-0.5 text-xs text-slate-400">
          {formatRelativeTime(event.created_at)}
        </Text>
      </View>
    </View>
  );
}

function NoGroups({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <View testID="groups-empty-state" className="flex-1 items-center justify-center py-16">
      <Text className="text-5xl">👥</Text>
      <Text className="mt-4 text-xl font-semibold text-slate-900">No groups yet</Text>
      <Text className="mt-1 px-8 text-center text-base text-slate-500">
        Create a group and invite friends, or join one with an invite code.
      </Text>
      <View className="mt-8 w-full gap-3 px-6">
        <Button title="Create a group" onPress={onCreate} testID="create-group-cta" />
        <Button title="Join a group" onPress={onJoin} variant="secondary" testID="join-group-cta" />
      </View>
    </View>
  );
}

export function GroupsScreen({ navigation }: Props) {
  const myGroups = useGroupsStore((state) => state.myGroups);
  const activeGroupId = useGroupsStore((state) => state.activeGroupId);
  const isLoading = useGroupsStore((state) => state.isLoading);
  const isRefreshing = useGroupsStore((state) => state.isRefreshing);
  const storeError = useGroupsStore((state) => state.error);
  const loadGroups = useGroupsStore((state) => state.loadGroups);
  const selectGroup = useGroupsStore((state) => state.selectGroup);
  const leave = useGroupsStore((state) => state.leave);
  const loadMembers = useGroupsStore((state) => state.loadMembers);
  const loadActivity = useGroupsStore((state) => state.loadActivity);
  const members = useGroupsStore((state) =>
    activeGroupId ? state.membersByGroup[activeGroupId] : undefined,
  );
  const memberHabits = useGroupsStore((state) =>
    activeGroupId ? state.memberHabitsByGroup[activeGroupId] : undefined,
  );
  const memberCompletions = useGroupsStore((state) =>
    activeGroupId ? state.memberCompletionsByGroup[activeGroupId] : undefined,
  );
  const events = useGroupsStore((state) =>
    activeGroupId ? state.eventsByGroup[activeGroupId] : undefined,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (activeGroupId) {
      void loadMembers(activeGroupId);
      void loadActivity(activeGroupId);
    }
  }, [activeGroupId, loadMembers, loadActivity]);

  useGroupRealtime(activeGroupId);

  // The selector allocates a fresh array, so it must not run inside the
  // zustand subscription (useSyncExternalStore requires stable snapshots);
  // memoize over the narrow slices instead.
  const leaderboard = useMemo(() => {
    if (!activeGroupId) {
      return [];
    }
    return selectLeaderboard(
      {
        membersByGroup: { [activeGroupId]: members ?? [] },
        memberHabitsByGroup: { [activeGroupId]: memberHabits ?? [] },
        memberCompletionsByGroup: { [activeGroupId]: memberCompletions ?? [] },
      },
      activeGroupId,
    );
  }, [activeGroupId, members, memberHabits, memberCompletions]);

  const activeGroup = myGroups.find((group) => group.id === activeGroupId);

  const handleRefresh = useCallback(() => {
    if (activeGroupId) {
      void loadMembers(activeGroupId);
      void loadActivity(activeGroupId);
    }
  }, [activeGroupId, loadMembers, loadActivity]);

  const handleLeave = useCallback(
    (group: GroupWithMemberCount) => {
      Alert.alert('Leave group', `Leave "${group.name}"? You can rejoin with an invite code.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            void leave(group.id).then((result) => {
              if (result.error) {
                setActionError(result.error);
              }
            });
          },
        },
      ]);
    },
    [leave],
  );

  const error = actionError ?? storeError;

  const header = (
    <View>
      {myGroups.length >= 2 ? (
        <GroupSelector groups={myGroups} activeGroupId={activeGroupId} onSelect={selectGroup} />
      ) : null}
      {activeGroup ? (
        <>
          <InviteCard group={activeGroup} onLeave={handleLeave} />
          <Text className="mb-2 text-lg font-bold text-slate-900">Leaderboard</Text>
          <View className="mb-4 rounded-2xl bg-white px-4 shadow-sm">
            {leaderboard.length === 0 ? (
              <Text className="py-4 text-sm text-slate-500">Loading members…</Text>
            ) : (
              leaderboard.map((entry, index) => (
                <LeaderboardRow key={entry.userId} entry={entry} rank={index + 1} />
              ))
            )}
          </View>
          <Text className="mb-2 text-lg font-bold text-slate-900">Activity</Text>
        </>
      ) : null}
    </View>
  );

  return (
    <Screen edges={['top']}>
      <View className="flex-row items-center justify-between px-6 pb-4 pt-2">
        <Text className="text-3xl font-bold text-slate-900">Groups</Text>
        <View className="flex-row items-center gap-2">
          <Pressable
            testID="join-group-button"
            accessibilityRole="button"
            accessibilityLabel="Join a group"
            onPress={() => navigation.navigate('JoinGroup')}
            className="h-11 items-center justify-center rounded-full bg-slate-200 px-4 active:bg-slate-300"
          >
            <Text className="text-sm font-semibold text-slate-700">Join</Text>
          </Pressable>
          <Pressable
            testID="create-group-button"
            accessibilityRole="button"
            accessibilityLabel="Create group"
            onPress={() => navigation.navigate('CreateGroup')}
            className="h-11 w-11 items-center justify-center rounded-full bg-emerald-600 active:bg-emerald-700"
          >
            <Text className="text-2xl leading-7 text-white">+</Text>
          </Pressable>
        </View>
      </View>

      {error ? (
        <View testID="groups-error" className="mx-6 mb-3 rounded-xl bg-red-50 px-4 py-3">
          <Text className="text-sm text-red-700">{error}</Text>
        </View>
      ) : null}

      {!isLoading && myGroups.length === 0 ? (
        <NoGroups
          onCreate={() => navigation.navigate('CreateGroup')}
          onJoin={() => navigation.navigate('JoinGroup')}
        />
      ) : (
        <FlatList
          data={events ?? []}
          keyExtractor={(event) => event.id}
          renderItem={({ item }) => <FeedRow event={item} />}
          contentContainerClassName="flex-grow px-6 pb-6"
          ListHeaderComponent={header}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#059669"
            />
          }
          ListEmptyComponent={
            activeGroup ? (
              <Text testID="feed-empty" className="text-sm text-slate-500">
                No activity yet. Check off a habit or invite a friend to get things moving!
              </Text>
            ) : null
          }
        />
      )}
    </Screen>
  );
}
