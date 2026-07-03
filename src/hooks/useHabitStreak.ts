import { useMemo } from 'react';

import { computeHabitStreak, Streak, todayLocalISO } from '../lib/streaks';
import { useHabitsStore } from '../store/habits';

/**
 * Live current/longest streak for one habit. Subscribes to narrow store
 * slices (the habit row and its completion dates) so the streak object is
 * only rebuilt when that habit's data actually changes.
 */
export function useHabitStreak(habitId: string): Streak {
  const habit = useHabitsStore((state) =>
    state.habits.find((candidate) => candidate.id === habitId),
  );
  const dates = useHabitsStore((state) => state.completions[habitId]);
  const today = todayLocalISO();

  return useMemo(() => {
    if (!habit) {
      return { current: 0, longest: 0 };
    }
    return computeHabitStreak(habit, dates ?? [], today);
  }, [habit, dates, today]);
}
