import { create } from 'zustand';

import { useAuthStore } from './auth';
import { listActivityEvents } from '../lib/activity';
import {
  createGroup,
  deleteGroup,
  GroupWithMemberCount,
  joinGroupByInviteCode,
  leaveGroup,
  listGroupMembers,
  listMemberHabitData,
  listMyGroups,
} from '../lib/groups';
import { computeHabitStreak, todayLocalISO } from '../lib/streaks';
import {
  ActivityEvent,
  ActivityEventWithProfile,
  GroupMember,
  GroupRole,
  Habit,
  HabitCompletion,
} from '../types';

const SIGNED_OUT_MESSAGE = 'You need to be signed in to do that.';
const NETWORK_MESSAGE = 'Network error. Check your connection and try again.';
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

/** Translate data-layer failures (PostgrestError, fetch errors) into UI copy. */
function getGroupsErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/fetch|network/i.test(error.message)) {
      return NETWORK_MESSAGE;
    }
    return error.message || FALLBACK_MESSAGE;
  }
  return FALLBACK_MESSAGE;
}

interface GroupsResult {
  error: string | null;
}

interface JoinByCodeResult extends GroupsResult {
  /** True when the code was valid but the user already belonged to the
   * group — worth telling them, since nothing else visibly changes. */
  alreadyMember: boolean;
}

interface GroupsState {
  myGroups: GroupWithMemberCount[];
  /** Which group's feed/leaderboard is shown. In-memory only for now —
   * Phase 4 adds proper persistence. */
  activeGroupId: string | null;
  membersByGroup: Record<string, GroupMember[]>;
  /** Group peers' habits/completions backing the leaderboard, keyed by group. */
  memberHabitsByGroup: Record<string, Habit[]>;
  memberCompletionsByGroup: Record<string, HabitCompletion[]>;
  /** Activity feed per group, newest first. */
  eventsByGroup: Record<string, ActivityEventWithProfile[]>;
  /** True while the group list loads. */
  isLoading: boolean;
  /** True while the active group's members/feed reload. */
  isRefreshing: boolean;
  /** Message from the most recent failed load; mutations report errors via their result. */
  error: string | null;
  loadGroups: () => Promise<void>;
  selectGroup: (groupId: string) => void;
  create: (name: string) => Promise<GroupsResult>;
  joinByCode: (code: string) => Promise<JoinByCodeResult>;
  leave: (groupId: string) => Promise<GroupsResult>;
  /** Owner-only hard delete (see lib deleteGroup); cleans up like leave. */
  deleteGroup: (groupId: string) => Promise<GroupsResult>;
  loadMembers: (groupId: string) => Promise<void>;
  loadActivity: (groupId: string) => Promise<void>;
  /** Prepends a realtime INSERT to the feed (deduped by id). */
  ingestRealtimeEvent: (event: ActivityEvent) => void;
  /** Locally patches the signed-in user's own rows in every group's cached
   * leaderboard data after a completion toggle — no refetch. */
  patchOwnCompletionData: (userId: string, habit: Habit, completedDates: string[]) => void;
}

/**
 * State updates shared by leave and deleteGroup: drop the group and every
 * per-group cache, moving the selection when it pointed at the removed
 * group.
 */
function removeGroupFromState(state: GroupsState, groupId: string): Partial<GroupsState> {
  const myGroups = state.myGroups.filter((group) => group.id !== groupId);
  const membersByGroup = { ...state.membersByGroup };
  const memberHabitsByGroup = { ...state.memberHabitsByGroup };
  const memberCompletionsByGroup = { ...state.memberCompletionsByGroup };
  const eventsByGroup = { ...state.eventsByGroup };
  delete membersByGroup[groupId];
  delete memberHabitsByGroup[groupId];
  delete memberCompletionsByGroup[groupId];
  delete eventsByGroup[groupId];
  return {
    myGroups,
    membersByGroup,
    memberHabitsByGroup,
    memberCompletionsByGroup,
    eventsByGroup,
    activeGroupId:
      state.activeGroupId === groupId ? (myGroups[0]?.id ?? null) : state.activeGroupId,
  };
}

export const useGroupsStore = create<GroupsState>((set, get) => ({
  myGroups: [],
  activeGroupId: null,
  membersByGroup: {},
  memberHabitsByGroup: {},
  memberCompletionsByGroup: {},
  eventsByGroup: {},
  isLoading: false,
  isRefreshing: false,
  error: null,

  loadGroups: async () => {
    set({ isLoading: true, error: null });
    try {
      const myGroups = await listMyGroups();
      set((state) => ({
        myGroups,
        isLoading: false,
        // Keep the current selection when it still exists; otherwise fall
        // back to the first group (or none).
        activeGroupId: myGroups.some((group) => group.id === state.activeGroupId)
          ? state.activeGroupId
          : (myGroups[0]?.id ?? null),
      }));
    } catch (error) {
      set({ isLoading: false, error: getGroupsErrorMessage(error) });
    }
  },

  selectGroup: (groupId) => {
    set({ activeGroupId: groupId });
  },

  create: async (name) => {
    const user = useAuthStore.getState().user;
    if (!user) {
      return { error: SIGNED_OUT_MESSAGE };
    }
    try {
      const group = await createGroup(user.id, name);
      set((state) => ({
        myGroups: [...state.myGroups, { ...group, member_count: 1 }],
        activeGroupId: group.id,
      }));
      return { error: null };
    } catch (error) {
      return { error: getGroupsErrorMessage(error) };
    }
  },

  joinByCode: async (code) => {
    try {
      const { group, alreadyMember } = await joinGroupByInviteCode(code);
      set((state) => ({
        myGroups: state.myGroups.some((existing) => existing.id === group.id)
          ? state.myGroups
          : // member_count is refreshed by the loadGroups below; +1 for self
            // is the best guess should that refresh fail.
            [...state.myGroups, { ...group, member_count: 1 }],
        activeGroupId: group.id,
      }));
      // Refresh from the server for the real member count (and any groups
      // joined elsewhere). loadGroups preserves the selection made above and
      // swallows its own failures, so a flaky refresh can't fail the join.
      await get().loadGroups();
      return { error: null, alreadyMember };
    } catch (error) {
      return { error: getGroupsErrorMessage(error), alreadyMember: false };
    }
  },

  leave: async (groupId) => {
    const user = useAuthStore.getState().user;
    if (!user) {
      return { error: SIGNED_OUT_MESSAGE };
    }
    try {
      await leaveGroup(groupId, user.id);
      set((state) => removeGroupFromState(state, groupId));
      return { error: null };
    } catch (error) {
      return { error: getGroupsErrorMessage(error) };
    }
  },

  deleteGroup: async (groupId) => {
    try {
      await deleteGroup(groupId);
      set((state) => removeGroupFromState(state, groupId));
      return { error: null };
    } catch (error) {
      return { error: getGroupsErrorMessage(error) };
    }
  },

  loadMembers: async (groupId) => {
    set({ isRefreshing: true });
    try {
      const members = await listGroupMembers(groupId);
      const { habits, completions } = await listMemberHabitData(
        members.map((member) => member.user_id),
      );
      set((state) => ({
        isRefreshing: false,
        membersByGroup: { ...state.membersByGroup, [groupId]: members },
        memberHabitsByGroup: { ...state.memberHabitsByGroup, [groupId]: habits },
        memberCompletionsByGroup: { ...state.memberCompletionsByGroup, [groupId]: completions },
      }));
    } catch (error) {
      set({ isRefreshing: false, error: getGroupsErrorMessage(error) });
    }
  },

  loadActivity: async (groupId) => {
    try {
      const events = await listActivityEvents(groupId);
      set((state) => ({ eventsByGroup: { ...state.eventsByGroup, [groupId]: events } }));
    } catch (error) {
      set({ error: getGroupsErrorMessage(error) });
    }
  },

  // Called by the habits store when the user's own toggle succeeds: patch
  // this user's habit/completion rows inside every group whose leaderboard
  // data is already cached, so selectLeaderboard reflects the new streak
  // immediately instead of waiting for the activity event to round-trip
  // through the database and Realtime. Peers' rows are never touched here —
  // their changes keep arriving via the Realtime-driven loadMembers refetch.
  patchOwnCompletionData: (userId, habit, completedDates) => {
    set((state) => {
      const groupIds = Object.keys(state.memberHabitsByGroup);
      if (groupIds.length === 0) {
        return state;
      }
      const memberHabitsByGroup = { ...state.memberHabitsByGroup };
      const memberCompletionsByGroup = { ...state.memberCompletionsByGroup };
      const now = new Date().toISOString();
      for (const groupId of groupIds) {
        const habits = memberHabitsByGroup[groupId];
        memberHabitsByGroup[groupId] = habits.some((cached) => cached.id === habit.id)
          ? habits.map((cached) => (cached.id === habit.id ? habit : cached))
          : [...habits, habit];
        memberCompletionsByGroup[groupId] = [
          // Habit ids are unique to their owner, so filtering by habit_id
          // can only ever drop this user's own rows.
          ...(memberCompletionsByGroup[groupId] ?? []).filter(
            (completion) => completion.habit_id !== habit.id,
          ),
          ...completedDates.map((date) => ({
            // Cache-only placeholder rows, replaced wholesale by the next
            // loadMembers refetch; the leaderboard math reads only
            // habit_id/user_id/completed_on.
            id: `local-${habit.id}-${date}`,
            habit_id: habit.id,
            user_id: userId,
            completed_on: date,
            created_at: now,
            updated_at: now,
          })),
        ];
      }
      return { memberHabitsByGroup, memberCompletionsByGroup };
    });
  },

  ingestRealtimeEvent: (event) => {
    set((state) => {
      const existing = state.eventsByGroup[event.group_id] ?? [];
      if (existing.some((candidate) => candidate.id === event.id)) {
        return state;
      }
      // Realtime rows arrive without the profiles join; resolve the actor
      // from the loaded member list (a fresh member shows up after the
      // members refetch the realtime hook triggers alongside this).
      const profile =
        (state.membersByGroup[event.group_id] ?? []).find(
          (member) => member.user_id === event.user_id,
        )?.profile ?? null;
      return {
        eventsByGroup: {
          ...state.eventsByGroup,
          [event.group_id]: [{ ...event, profile }, ...existing],
        },
      };
    });
  },
}));

export interface LeaderboardEntry {
  userId: string;
  username: string;
  displayName: string;
  role: GroupRole;
  /** Sum of the member's current streaks; daily and weekly habits both count
   * one "streak unit" per consecutive period. */
  totalStreak: number;
}

/**
 * Pure selector: members of a group ranked by the sum of their current
 * streaks across their non-deleted habits, descending; ties break
 * alphabetically by username.
 */
export function selectLeaderboard(
  state: Pick<GroupsState, 'membersByGroup' | 'memberHabitsByGroup' | 'memberCompletionsByGroup'>,
  groupId: string,
  today: string = todayLocalISO(),
): LeaderboardEntry[] {
  const members = state.membersByGroup[groupId] ?? [];
  const habits = state.memberHabitsByGroup[groupId] ?? [];
  const completions = state.memberCompletionsByGroup[groupId] ?? [];

  const datesByHabit: Record<string, string[]> = {};
  for (const completion of completions) {
    (datesByHabit[completion.habit_id] ??= []).push(completion.completed_on);
  }

  const entries = members.map((member) => {
    const totalStreak = habits
      .filter((habit) => habit.user_id === member.user_id && habit.deleted_at === null)
      .reduce(
        (sum, habit) =>
          sum + computeHabitStreak(habit, datesByHabit[habit.id] ?? [], today).current,
        0,
      );
    return {
      userId: member.user_id,
      username: member.profile.username,
      displayName: member.profile.display_name,
      role: member.role,
      totalStreak,
    };
  });

  return entries.sort(
    (a, b) => b.totalStreak - a.totalStreak || a.username.localeCompare(b.username),
  );
}
