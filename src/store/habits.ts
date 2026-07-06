import { create } from 'zustand';

import { useAuthStore } from './auth';
import { registerOwnPendingSyncProvider, useGroupsStore } from './groups';
import { insertActivityEvent } from '../lib/activity';
import { detectStreakActivity, habitCreatedEvent } from '../lib/activityEvents';
import { ExpoPushMessage, sendExpoPushMessages } from '../lib/expoPush';
import {
  cancelHabitReminder,
  reconcileHabitReminders,
  scheduleHabitReminder,
} from '../lib/habitReminders';
import { HabitInput } from '../lib/habits';
import {
  getSyncQueueSummary,
  hydrateHabitsData,
  localCreateHabit,
  localSoftDeleteHabit,
  localToggleCompletion,
  localUpdateHabit,
} from '../lib/localHabits';
import { getIsOnline } from '../lib/network';
import { deleteInvalidTokens, listGroupPeerTokens } from '../lib/pushTokens';
import { computeHabitStreak, Streak, todayLocalISO } from '../lib/streaks';
import { drainSyncQueue, reconcile } from '../lib/syncEngine';
import { ActivityEventData, Habit } from '../types';

const SIGNED_OUT_MESSAGE = 'You need to be signed in to do that.';
const NETWORK_MESSAGE = 'Network error. Check your connection and try again.';
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

/** Translate data-layer failures (PostgrestError, fetch errors) into UI copy. */
function getHabitsErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/fetch|network/i.test(error.message)) {
      return NETWORK_MESSAGE;
    }
    return error.message || FALLBACK_MESSAGE;
  }
  return FALLBACK_MESSAGE;
}

interface HabitsResult {
  error: string | null;
}

export interface CompletionChange {
  habit: Habit;
  /** Local calendar date (YYYY-MM-DD) whose completion changed. */
  date: string;
  /** New state: true when the completion was turned on. */
  completed: boolean;
  /** Ascending completion dates before and after the change. */
  before: string[];
  after: string[];
}

/**
 * streak_continued only triggers a push when the new streak is a multiple of
 * this — meaningful milestones only, avoid notifying peers on every single
 * daily check-in (that trains them to mute the app). streak_broken always
 * pushes regardless: a broken streak is the accountability moment this app
 * exists for. habit_created never pushes — too frequent, too low-value (it
 * still lands in the activity feed).
 */
const STREAK_MILESTONE_INTERVAL = 5;

function isPushWorthy(event: ActivityEventData): boolean {
  if (event.type === 'streak_broken') {
    return true;
  }
  return (
    event.type === 'streak_continued' &&
    event.payload.current_streak % STREAK_MILESTONE_INTERVAL === 0
  );
}

function buildPushMessages(
  event: ActivityEventData,
  actorName: string,
  tokens: string[],
): ExpoPushMessage[] {
  if (event.type !== 'streak_broken' && event.type !== 'streak_continued') {
    return [];
  }
  const unit = event.payload.frequency === 'weekly' ? 'week' : 'day';
  const { title, body } =
    event.type === 'streak_broken'
      ? {
          title: `${actorName} broke a streak 💔`,
          body: `Their ${event.payload.previous_streak}-${unit} streak on "${event.payload.habit_name}" just ended. Send some encouragement!`,
        }
      : {
          title: `${actorName} is on fire 🔥`,
          body: `"${event.payload.habit_name}" just hit a ${event.payload.current_streak}-${unit} streak.`,
        };
  return tokens.map((to) => ({
    to,
    title,
    body,
    data: { type: event.type, habit_id: event.payload.habit_id },
  }));
}

/**
 * Device-to-device social push: the acting user's phone notifies group
 * peers directly through Expo's push API (no server-side function — see
 * migration 0006). Recipients are the OTHER members of every shared group,
 * deduped by token so a peer sharing two groups gets ONE push per event
 * (unlike activity rows, which are legitimately one per group feed).
 * DeviceNotRegistered receipts are routine cleanup, not errors: those
 * tokens belong to uninstalled apps and are deleted so future sends stop
 * paying for dead addresses.
 */
async function sendSocialPushes(userId: string, events: ActivityEventData[]): Promise<void> {
  const pushable = events.filter(isPushWorthy);
  if (pushable.length === 0) {
    return;
  }
  const sharedGroups = useGroupsStore.getState().myGroups.filter((group) => group.member_count > 1);
  if (sharedGroups.length === 0) {
    return;
  }
  const tokenLists = await Promise.all(
    sharedGroups.map((group) => listGroupPeerTokens(userId, group.id)),
  );
  const tokens = [...new Set(tokenLists.flat())];
  if (tokens.length === 0) {
    return;
  }
  const actorName = useAuthStore.getState().profile?.display_name ?? 'A group member';
  const messages = pushable.flatMap((event) => buildPushMessages(event, actorName, tokens));
  const { invalidTokens } = await sendExpoPushMessages(messages);
  if (invalidTokens.length > 0) {
    await deleteInvalidTokens(invalidTokens);
  }
}

/**
 * Fans activity events out to every group the acting user shares with at
 * least one other member. Solo users cost nothing here: the group list is an
 * in-memory read (loaded once at app start by AppNavigator), so no query
 * runs and no rows are written. Best-effort by design — the feed must never
 * block or fail the habit mutation that triggered it, and (per the Phase 4
 * scope decision) activity events are NOT queued for offline retry: social
 * features stay online-only, so an offline publish just fails silently.
 *
 * Social pushes ride the exact same call (and hence the same post-sync
 * timing and session dedup): a device that is offline here simply doesn't
 * send them — the accepted activity-events limitation, applied unchanged.
 */
function publishActivity(events: ActivityEventData[]): void {
  if (events.length === 0) {
    return;
  }
  const user = useAuthStore.getState().user;
  if (!user) {
    return;
  }
  const sharedGroups = useGroupsStore.getState().myGroups.filter((group) => group.member_count > 1);
  for (const group of sharedGroups) {
    for (const event of events) {
      void insertActivityEvent({ groupId: group.id, userId: user.id, event }).catch(
        () => undefined,
      );
    }
  }
  void sendSocialPushes(user.id, events).catch(() => undefined);
}

// Streak events already published this session, keyed by type/habit/date but
// not by group: one publish fans out to every shared group at once. Toggling
// the same completion off and on again re-detects the same "increase", and
// there is no point re-attempting inserts the database would reject anyway.
// The DB's partial unique indexes (migration 0005) remain the real
// guarantee — this set is only the client-side half of the dedup.
const publishedStreakEvents = new Set<string>();

/** Clears the session dedup registry (used by tests; a future sign-out flow
 * should call it too so a next account starts fresh). */
export function resetPublishedActivityEvents(): void {
  publishedStreakEvents.clear();
}

// Phase 3 hook: every completion mutation ends here after the local write
// succeeds (SQLite is the source of truth, so the local write IS the
// mutation), keeping event detection at the same point in the flow as when
// it ran after the direct API call.
function notifyCompletionChanged(change: CompletionChange): void {
  const events = detectStreakActivity(change).filter((event) => {
    if (event.type !== 'streak_continued' && event.type !== 'streak_broken') {
      return true;
    }
    const key = `${event.type}:${event.payload.habit_id}:${event.payload.event_date}`;
    if (publishedStreakEvents.has(key)) {
      return false;
    }
    publishedStreakEvents.add(key);
    return true;
  });
  publishActivity(events);
}

interface HabitsState {
  habits: Habit[];
  /** Ascending YYYY-MM-DD completion dates per habit id. */
  completions: Record<string, string[]>;
  /** Kept for API compatibility; hydration is synchronous SQLite reads, so
   * it only flags the signed-out early return now. */
  isLoading: boolean;
  /** True while an explicit pull-to-refresh reconciliation runs. */
  isSyncing: boolean;
  /** Message from the most recent failed server sync; local reads/writes
   * cannot fail this way. */
  error: string | null;
  /** Habits with queued offline mutations (their own or a completion's). */
  pendingSyncHabitIds: string[];
  /** True when a queued mutation gave up after repeated permanent errors. */
  hasSyncFailures: boolean;
  /** Hydrates from SQLite instantly, then reconciles in the background. */
  load: () => Promise<void>;
  /** Pull-to-refresh: like load, but drives the isSyncing spinner. */
  refresh: () => Promise<void>;
  /** Reconciles with the server and drains the sync queue (no-op offline). */
  syncNow: () => Promise<void>;
  create: (input: HabitInput) => Promise<HabitsResult>;
  update: (habitId: string, input: Partial<HabitInput>) => Promise<HabitsResult>;
  remove: (habitId: string) => Promise<HabitsResult>;
  /** Toggles the completion for `date` (defaults to today) — local-first. */
  toggle: (habitId: string, date?: string) => Promise<HabitsResult>;
}

export const useHabitsStore = create<HabitsState>((set, get) => {
  /**
   * Re-reads SQLite and updates the store ONLY when something actually
   * changed — reconciliation after which nothing differs must not produce
   * new references (and hence no re-render/reflow of the habit list).
   */
  const rehydrateIfChanged = (userId: string): void => {
    const { habits, completions } = hydrateHabitsData(userId);
    const summary = getSyncQueueSummary(userId);
    const state = get();
    const updates: Partial<HabitsState> = {};
    if (
      JSON.stringify([habits, completions]) !== JSON.stringify([state.habits, state.completions])
    ) {
      updates.habits = habits;
      updates.completions = completions;
    }
    if (summary.pendingHabitIds.join('\n') !== state.pendingSyncHabitIds.join('\n')) {
      updates.pendingSyncHabitIds = summary.pendingHabitIds;
    }
    if (summary.hasFailures !== state.hasSyncFailures) {
      updates.hasSyncFailures = summary.hasFailures;
    }
    if (Object.keys(updates).length > 0) {
      set(updates);
    }
    if (updates.habits && updates.completions) {
      // Background reconciliation changed local truth (e.g. a habit synced
      // as deleted from another device): stale reminders must not survive.
      // Local-only scheduling, best-effort, never blocks the sync path.
      void reconcileHabitReminders(updates.habits, updates.completions).catch(() => undefined);
    }
  };

  /** Fire-and-forget push of queued mutations after a local write. */
  const drainInBackground = async (userId: string): Promise<void> => {
    if (!getIsOnline()) {
      return;
    }
    try {
      await drainSyncQueue(userId);
    } catch {
      // A drain that dies unexpectedly is retried by the next trigger
      // (reconnect, foreground, next mutation); failures that matter are
      // recorded on the queue rows themselves and surfaced via the summary.
    }
    rehydrateIfChanged(userId);
  };

  return {
    habits: [],
    completions: {},
    isLoading: false,
    isSyncing: false,
    error: null,
    pendingSyncHabitIds: [],
    hasSyncFailures: false,

    load: async () => {
      const user = useAuthStore.getState().user;
      if (!user) {
        set({ isLoading: false, error: SIGNED_OUT_MESSAGE });
        return;
      }
      // Local data first: synchronous SQLite reads, no network wait, no
      // spinner. The server reconciliation below happens in the background
      // relative to the UI (state is already set when it starts).
      const { habits, completions } = hydrateHabitsData(user.id);
      const summary = getSyncQueueSummary(user.id);
      set({
        habits,
        completions,
        isLoading: false,
        error: null,
        pendingSyncHabitIds: summary.pendingHabitIds,
        hasSyncFailures: summary.hasFailures,
      });
      await get().syncNow();
      // App-launch reconciliation of local reminder schedules against the
      // (possibly server-updated) habit list — deleted or switched-to-weekly
      // habits lose their reminders, active daily habits get exactly one.
      void reconcileHabitReminders(get().habits, get().completions).catch(() => undefined);
    },

    refresh: async () => {
      set({ isSyncing: true });
      try {
        await get().syncNow();
      } finally {
        set({ isSyncing: false });
      }
    },

    syncNow: async () => {
      const user = useAuthStore.getState().user;
      if (!user) {
        return;
      }
      if (!getIsOnline()) {
        // Nothing to reconcile against; just refresh the queue-derived
        // indicators so the UI reflects the latest local mutations.
        rehydrateIfChanged(user.id);
        return;
      }
      try {
        await reconcile(user.id);
        if (get().error !== null) {
          set({ error: null });
        }
      } catch (error) {
        set({ error: getHabitsErrorMessage(error) });
      }
      rehydrateIfChanged(user.id);
    },

    create: async (input) => {
      const user = useAuthStore.getState().user;
      if (!user) {
        return { error: SIGNED_OUT_MESSAGE };
      }
      try {
        const habit = localCreateHabit(user.id, input);
        // Habits are listed oldest-first, so the new one belongs at the end.
        set((state) => ({
          habits: [...state.habits, habit],
          pendingSyncHabitIds: [...new Set([...state.pendingSyncHabitIds, habit.id])].sort(),
        }));
        publishActivity([habitCreatedEvent(habit)]);
        // New daily habits get their reminder immediately (weekly ones are
        // out of reminder scope — scheduleHabitReminder resolves that).
        void scheduleHabitReminder(habit, []).catch(() => undefined);
        void drainInBackground(user.id);
        return { error: null };
      } catch (error) {
        return { error: getHabitsErrorMessage(error) };
      }
    },

    update: async (habitId, input) => {
      const user = useAuthStore.getState().user;
      if (!user) {
        return { error: SIGNED_OUT_MESSAGE };
      }
      try {
        const habit = localUpdateHabit(user.id, habitId, input);
        if (!habit) {
          return { error: FALLBACK_MESSAGE };
        }
        set((state) => ({
          habits: state.habits.map((existing) => (existing.id === habitId ? habit : existing)),
          pendingSyncHabitIds: [...new Set([...state.pendingSyncHabitIds, habitId])].sort(),
        }));
        // Covers renames (reminder text) and daily<->weekly switches (a
        // now-weekly habit's reminder is canceled).
        void scheduleHabitReminder(habit, get().completions[habitId] ?? []).catch(() => undefined);
        void drainInBackground(user.id);
        return { error: null };
      } catch (error) {
        return { error: getHabitsErrorMessage(error) };
      }
    },

    remove: async (habitId) => {
      const user = useAuthStore.getState().user;
      if (!user) {
        return { error: SIGNED_OUT_MESSAGE };
      }
      try {
        if (!localSoftDeleteHabit(user.id, habitId)) {
          return { error: FALLBACK_MESSAGE };
        }
        set((state) => {
          const completions = { ...state.completions };
          delete completions[habitId];
          return {
            habits: state.habits.filter((habit) => habit.id !== habitId),
            completions,
          };
        });
        // A deleted habit must never remind again.
        void cancelHabitReminder(habitId).catch(() => undefined);
        void drainInBackground(user.id);
        return { error: null };
      } catch (error) {
        return { error: getHabitsErrorMessage(error) };
      }
    },

    toggle: async (habitId, date = todayLocalISO()) => {
      const { habits, completions } = get();
      const habit = habits.find((candidate) => candidate.id === habitId);
      if (!habit) {
        return { error: FALLBACK_MESSAGE };
      }
      const user = useAuthStore.getState().user;
      if (!user) {
        return { error: SIGNED_OUT_MESSAGE };
      }

      try {
        // SQLite is the optimistic state: the local write is the mutation,
        // and the queued row reconciles with the server asynchronously. No
        // in-memory rollback is needed anymore — a failed server sync can
        // no longer "un-toggle" the UI.
        const { completed } = localToggleCompletion({ habitId, userId: user.id, date });
        const before = completions[habitId] ?? [];
        const after = completed ? [...before, date].sort() : before.filter((d) => d !== date);
        set((state) => ({
          completions: { ...state.completions, [habitId]: after },
          pendingSyncHabitIds: [...new Set([...state.pendingSyncHabitIds, habitId])].sort(),
        }));

        // Streak math and leaderboard patching still fire immediately on the
        // (now local) write; the activity events wait for the background
        // drain. Realtime peers refetch the whole leaderboard the moment the
        // event row lands, so publishing before the completion itself has
        // synced would hand every member (this device included) a server
        // snapshot that predates the toggle. Offline or failed drains keep
        // today's semantics: the publish attempt just fails silently (events
        // are online-only by the Phase 4 scope decision).
        useGroupsStore.getState().patchOwnCompletionData(user.id, habit, after);
        // Reminder follows the new completion state instantly and offline:
        // completing today cancels today's pending reminder, unchecking it
        // brings the reminder back for the next occurrence.
        void scheduleHabitReminder(habit, after).catch(() => undefined);
        const change: CompletionChange = { habit, date, completed, before, after };
        void drainInBackground(user.id).then(() => notifyCompletionChanged(change));
        return { error: null };
      } catch (error) {
        return { error: getHabitsErrorMessage(error) };
      }
    },
  };
});

// loadMembers merges rather than replaces the signed-in user's own cached
// leaderboard rows while their mutations are still queued; it learns which
// habits those are through this provider (see groups.ts).
registerOwnPendingSyncProvider(() => useHabitsStore.getState().pendingSyncHabitIds);

/** Pure selector: streak for one habit, derived from store state. */
export function selectHabitStreak(
  state: Pick<HabitsState, 'habits' | 'completions'>,
  habitId: string,
  today: string = todayLocalISO(),
): Streak {
  const habit = state.habits.find((candidate) => candidate.id === habitId);
  if (!habit) {
    return { current: 0, longest: 0 };
  }
  return computeHabitStreak(habit, state.completions[habitId] ?? [], today);
}

/** Pure selector: whether a habit is completed on the given date. */
export function selectIsCompleted(
  state: Pick<HabitsState, 'completions'>,
  habitId: string,
  date: string,
): boolean {
  return (state.completions[habitId] ?? []).includes(date);
}

/** Pure selector: whether a habit has mutations still waiting to sync. */
export function selectHasPendingSync(
  state: Pick<HabitsState, 'pendingSyncHabitIds'>,
  habitId: string,
): boolean {
  return state.pendingSyncHabitIds.includes(habitId);
}
