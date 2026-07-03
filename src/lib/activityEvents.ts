// Pure detection of feed-worthy streak activity. Publishing (who is signed
// in, which groups hear about it) lives with the stores; this module only
// decides WHICH events a completion change produces.

import { computeHabitStreak, todayLocalISO } from './streaks';
import { ActivityEventData, Habit } from '../types';

/** Streaks shorter than this break silently — losing a 1–2 period run is not feed-worthy. */
export const BROKEN_STREAK_THRESHOLD = 3;

export interface CompletionChangeInput {
  habit: Habit;
  /** Local calendar date (YYYY-MM-DD) whose completion changed. */
  date: string;
  /** New state: true when the completion was turned on. */
  completed: boolean;
  /** Ascending completion dates before and after the change. */
  before: string[];
  after: string[];
  /** Injectable for tests; defaults to the device's local date. */
  today?: string;
}

/**
 * Events produced by one completion change:
 *
 * - `streak_continued` fires whenever the completion INCREASES the habit's
 *   current streak (every ordinary check-in, not just milestones), carrying
 *   the new streak length.
 * - `streak_broken` fires when a streak that was >= BROKEN_STREAK_THRESHOLD
 *   reset to 0 because a day/week was missed. LIMITATION: a break is only
 *   observed on the NEXT check-in for that habit — nothing fires at the
 *   moment the missed day rolls over, so a user who stops checking in
 *   entirely never produces a broken event.
 *
 * Unchecking a completion emits nothing: it is an undo/edit, not a missed
 * period. Backfilling a past date can emit `streak_continued` (it repairs or
 * extends the current streak) but never `streak_broken` — only a check-in
 * for today counts as observing a gap.
 */
export function detectStreakActivity({
  habit,
  date,
  completed,
  before,
  after,
  today = todayLocalISO(),
}: CompletionChangeInput): ActivityEventData[] {
  if (!completed) {
    return [];
  }

  const events: ActivityEventData[] = [];
  const habitFields = {
    habit_id: habit.id,
    habit_name: habit.name,
    habit_icon: habit.icon,
    frequency: habit.frequency,
  };
  const beforeCurrent = computeHabitStreak(habit, before, today).current;
  const afterCurrent = computeHabitStreak(habit, after, today).current;

  if (date === today && beforeCurrent === 0 && before.length > 0) {
    // The streak the user HAD when they last checked in: evaluating the old
    // completions as of their own last date yields the run that ended there.
    const lastCompleted = before.reduce((a, b) => (a > b ? a : b));
    const endedStreak = computeHabitStreak(habit, before, lastCompleted).current;
    if (endedStreak >= BROKEN_STREAK_THRESHOLD) {
      events.push({
        type: 'streak_broken',
        payload: { ...habitFields, previous_streak: endedStreak },
      });
    }
  }

  if (afterCurrent > beforeCurrent) {
    events.push({
      type: 'streak_continued',
      payload: { ...habitFields, current_streak: afterCurrent },
    });
  }

  return events;
}

export function habitCreatedEvent(habit: Habit): ActivityEventData {
  return {
    type: 'habit_created',
    payload: { habit_id: habit.id, habit_name: habit.name, habit_icon: habit.icon },
  };
}
