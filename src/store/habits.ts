import { create } from 'zustand';

import { useAuthStore } from './auth';
import { useGroupsStore } from './groups';
import { insertActivityEvent } from '../lib/activity';
import { detectStreakActivity, habitCreatedEvent } from '../lib/activityEvents';
import {
  createHabit,
  HabitInput,
  listCompletions,
  listHabits,
  softDeleteHabit,
  toggleCompletion,
  updateHabit,
} from '../lib/habits';
import { computeHabitStreak, Streak, todayLocalISO } from '../lib/streaks';
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
 * Fans activity events out to every group the acting user shares with at
 * least one other member. Solo users cost nothing here: the group list is an
 * in-memory read (loaded once at app start by AppNavigator), so no query
 * runs and no rows are written. Best-effort by design — the feed must never
 * block or fail the habit mutation that triggered it.
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
}

// Phase 3 hook: every completion mutation ends here after it succeeds, so no
// refactoring of the toggle flow was needed to add activity events.
function notifyCompletionChanged(change: CompletionChange): void {
  publishActivity(detectStreakActivity(change));
}

interface HabitsState {
  habits: Habit[];
  /** Ascending YYYY-MM-DD completion dates per habit id. */
  completions: Record<string, string[]>;
  /** True while the initial load (or a refresh) is in flight. */
  isLoading: boolean;
  /** Message from the most recent failed load; mutations report errors via their result. */
  error: string | null;
  load: () => Promise<void>;
  create: (input: HabitInput) => Promise<HabitsResult>;
  update: (habitId: string, input: Partial<HabitInput>) => Promise<HabitsResult>;
  remove: (habitId: string) => Promise<HabitsResult>;
  /** Optimistically toggles the completion for `date` (defaults to today). */
  toggle: (habitId: string, date?: string) => Promise<HabitsResult>;
}

export const useHabitsStore = create<HabitsState>((set, get) => ({
  habits: [],
  completions: {},
  isLoading: false,
  error: null,

  load: async () => {
    const user = useAuthStore.getState().user;
    if (!user) {
      set({ isLoading: false, error: SIGNED_OUT_MESSAGE });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const [habits, completionRows] = await Promise.all([
        listHabits(user.id),
        listCompletions(user.id),
      ]);
      // Defense in depth: the queries already filter by user_id server-side,
      // but habits/habit_completions RLS deliberately also exposes group
      // peers' rows (for the leaderboard), so the personal list must never
      // trust result breadth — drop anything that isn't the user's own.
      const ownHabits = habits.filter((habit) => habit.user_id === user.id);
      const completions: Record<string, string[]> = {};
      for (const row of completionRows) {
        if (row.user_id === user.id) {
          (completions[row.habit_id] ??= []).push(row.completed_on);
        }
      }
      set({ habits: ownHabits, completions, isLoading: false });
    } catch (error) {
      set({ isLoading: false, error: getHabitsErrorMessage(error) });
    }
  },

  create: async (input) => {
    const user = useAuthStore.getState().user;
    if (!user) {
      return { error: SIGNED_OUT_MESSAGE };
    }
    try {
      const habit = await createHabit(user.id, input);
      // Habits are listed oldest-first, so the new one belongs at the end.
      set((state) => ({ habits: [...state.habits, habit] }));
      publishActivity([habitCreatedEvent(habit)]);
      return { error: null };
    } catch (error) {
      return { error: getHabitsErrorMessage(error) };
    }
  },

  update: async (habitId, input) => {
    try {
      const habit = await updateHabit(habitId, input);
      set((state) => ({
        habits: state.habits.map((existing) => (existing.id === habitId ? habit : existing)),
      }));
      return { error: null };
    } catch (error) {
      return { error: getHabitsErrorMessage(error) };
    }
  },

  remove: async (habitId) => {
    try {
      await softDeleteHabit(habitId);
      set((state) => {
        const completions = { ...state.completions };
        delete completions[habitId];
        return {
          habits: state.habits.filter((habit) => habit.id !== habitId),
          completions,
        };
      });
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

    const before = completions[habitId] ?? [];
    const completed = !before.includes(date);
    const after = completed ? [...before, date].sort() : before.filter((d) => d !== date);

    // Optimistic: apply the change immediately, roll back if the API fails.
    set((state) => ({ completions: { ...state.completions, [habitId]: after } }));
    try {
      await toggleCompletion({ habitId, userId: user.id, date, completed });
    } catch (error) {
      set((state) => ({ completions: { ...state.completions, [habitId]: before } }));
      return { error: getHabitsErrorMessage(error) };
    }

    notifyCompletionChanged({ habit, date, completed, before, after });
    return { error: null };
  },
}));

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
