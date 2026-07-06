// Personal daily reminders, scheduled entirely on-device with
// expo-notifications' local scheduling API. No server, no network: works
// fully offline, matching the app's local-first philosophy.
//
// SCOPE (Phase 5 product decision): only ACTIVE DAILY habits get reminders.
// Weekly habits are deliberately out of scope — "remind me before the week
// ends" needs different timing UX than a fixed evening nudge, so rather than
// half-implement it we schedule nothing for them. Soft-deleted habits never
// get (and lose any existing) reminder.

import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';

import { Habit } from '../types';

/**
 * Fixed local reminder time: 8:00 PM. A sensible constant for Phase 5 — the
 * settings UI to make it user-configurable is Phase 6's job.
 */
export const DEFAULT_REMINDER_HOUR = 20;

/** Prefix marking scheduled notifications as ours, so reconciliation can
 * recognize (and cancel) stale reminders without touching anything else. */
export const REMINDER_ID_PREFIX = 'habit-reminder-';

/**
 * Stable, deterministic identifier per habit. Scheduling with the same
 * identifier REPLACES the previous request on both platforms, which is what
 * makes rescheduling idempotent: one habit can never hold two reminders.
 */
export function reminderIdentifier(habitId: string): string {
  return `${REMINDER_ID_PREFIX}${habitId}`;
}

/** Local calendar date (YYYY-MM-DD) of a Date, matching todayLocalISO. */
function localDateISO(moment: Date): string {
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  const day = String(moment.getDate()).padStart(2, '0');
  return `${moment.getFullYear()}-${month}-${day}`;
}

/**
 * Decides what (if anything) to schedule for a habit. Pure — all the timing
 * edge cases live here where they are trivially testable.
 *
 * - Weekly or soft-deleted habit: nothing (see SCOPE above).
 * - Not completed today: a repeating DAILY trigger at 20:00. This covers
 *   today (when 20:00 hasn't passed) and every following day even if the
 *   app is never reopened — the user who stops opening the app is exactly
 *   the one who needs the nudge.
 * - Completed today before 20:00: today's occurrence must NOT fire, and a
 *   repeating daily trigger cannot skip its first occurrence, so we swap in
 *   a one-shot for tomorrow 20:00. The next reconciliation (app launch,
 *   foreground sync, any toggle) restores the repeating trigger once
 *   "completed today" no longer refers to this calendar day. Limitation: if
 *   the app is never opened again, reminders stop after that one-shot —
 *   acceptable, since it only arises for a user who completed the habit and
 *   then abandoned the app the same day.
 * - Completed today at/after 20:00: today's occurrence already passed; the
 *   repeating trigger's next fire is tomorrow, so it is safe to keep.
 */
export function computeReminderTrigger(
  habit: Habit,
  completedDates: string[],
  now: Date,
): Notifications.NotificationTriggerInput | null {
  if (habit.frequency !== 'daily' || habit.deleted_at !== null) {
    return null;
  }
  const completedToday = completedDates.includes(localDateISO(now));
  if (completedToday && now.getHours() < DEFAULT_REMINDER_HOUR) {
    const tomorrowReminder = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      DEFAULT_REMINDER_HOUR,
      0,
      0,
    );
    return { type: SchedulableTriggerInputTypes.DATE, date: tomorrowReminder };
  }
  return { type: SchedulableTriggerInputTypes.DAILY, hour: DEFAULT_REMINDER_HOUR, minute: 0 };
}

/**
 * Schedules (or clears) the reminder for one habit based on its current
 * completion state. Idempotent by construction: the deterministic identifier
 * makes a reschedule replace the existing request, never add a second one.
 */
export async function scheduleHabitReminder(
  habit: Habit,
  completedDates: string[],
  now: Date = new Date(),
): Promise<void> {
  const trigger = computeReminderTrigger(habit, completedDates, now);
  if (trigger === null) {
    await cancelHabitReminder(habit.id);
    return;
  }
  await Notifications.scheduleNotificationAsync({
    identifier: reminderIdentifier(habit.id),
    content: {
      title: `${habit.icon ?? '⏰'} ${habit.name}`,
      body: 'Not checked off yet today — keep your streak alive before the day ends.',
      data: { habit_id: habit.id },
    },
    trigger,
  });
}

/** Cancels a habit's reminder (deleted habit, or completed before 20:00). */
export async function cancelHabitReminder(habitId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(reminderIdentifier(habitId));
}

/**
 * Brings the OS schedule in line with the current habit list. Runs on app
 * launch (and after background reconciliation changes local data): habits
 * may have been deleted or switched to weekly from another device while the
 * app was closed, and their reminders must not survive that. Every active
 * daily habit is (re)scheduled — replacement semantics make that idempotent
 * — and any of our reminders whose habit is no longer an active daily habit
 * is canceled. Non-reminder notifications are never touched.
 */
export async function reconcileHabitReminders(
  habits: Habit[],
  completions: Record<string, string[]>,
  now: Date = new Date(),
): Promise<void> {
  const activeDaily = habits.filter(
    (habit) => habit.frequency === 'daily' && habit.deleted_at === null,
  );
  for (const habit of activeDaily) {
    await scheduleHabitReminder(habit, completions[habit.id] ?? [], now);
  }

  const wanted = new Set(activeDaily.map((habit) => reminderIdentifier(habit.id)));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const request of scheduled) {
    if (request.identifier.startsWith(REMINDER_ID_PREFIX) && !wanted.has(request.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }
}
