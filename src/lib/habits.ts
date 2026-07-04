import { randomUUID } from 'expo-crypto';

import { supabase } from './supabase';
import { Habit, HabitCompletion, HabitFrequency } from '../types';

// Postgres error code for unique constraint violations.
const UNIQUE_VIOLATION = '23505';

export interface HabitInput {
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  frequency: HabitFrequency;
  target_days_per_week: number | null;
}

/**
 * The user's own active habits, oldest first. The explicit user_id filter is
 * load-bearing, not redundant with RLS: the habits policies deliberately
 * also grant read access to group peers' rows (habits_select_group_peers,
 * for the Groups leaderboard), so a bare select here would silently include
 * peers' habits whenever the user shares a group. RLS is the backstop, never
 * the only scoping mechanism for personal queries.
 */
export async function listHabits(userId: string): Promise<Habit[]> {
  const { data, error } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) {
    throw error;
  }
  return (data ?? []) as Habit[];
}

export async function createHabit(userId: string, input: HabitInput): Promise<Habit> {
  // The id is generated client-side (not by the DB default) so that Phase 4
  // offline sync can create rows locally before the server ever sees them.
  const { data, error } = await supabase
    .from('habits')
    .insert({ id: randomUUID(), user_id: userId, ...input })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as Habit;
}

export async function updateHabit(habitId: string, input: Partial<HabitInput>): Promise<Habit> {
  const { data, error } = await supabase
    .from('habits')
    .update(input)
    .eq('id', habitId)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as Habit;
}

/** Marks the habit deleted. Never hard-delete: Phase 4 sync relies on deleted_at. */
export async function softDeleteHabit(habitId: string): Promise<void> {
  const { error } = await supabase
    .from('habits')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', habitId);
  if (error) {
    throw error;
  }
}

export interface CompletionRange {
  /** Inclusive lower bound (YYYY-MM-DD). Omit for all history. */
  from?: string;
  /** Inclusive upper bound (YYYY-MM-DD). */
  to?: string;
}

/**
 * The user's own completions, oldest first, optionally date-bounded. Like
 * listHabits, the explicit user_id filter matters: RLS also exposes group
 * peers' completions (habit_completions_select_group_peers) for the
 * leaderboard, so this must not rely on RLS breadth.
 */
export async function listCompletions(
  userId: string,
  range: CompletionRange = {},
): Promise<HabitCompletion[]> {
  let query = supabase.from('habit_completions').select('*').eq('user_id', userId);
  if (range.from) {
    query = query.gte('completed_on', range.from);
  }
  if (range.to) {
    query = query.lte('completed_on', range.to);
  }
  const { data, error } = await query.order('completed_on', { ascending: true });
  if (error) {
    throw error;
  }
  return (data ?? []) as HabitCompletion[];
}

export interface ToggleCompletionInput {
  habitId: string;
  userId: string;
  /** Local calendar date as YYYY-MM-DD. */
  date: string;
  /** Desired state: true inserts the completion row, false deletes it. */
  completed: boolean;
}

/**
 * Single entry point for every completion mutation (the Phase 3 activity-event
 * hook plugs into the flow that calls this, so keep all writes going through
 * here). Inserting is idempotent: UNIQUE(habit_id, completed_on) turns a
 * duplicate insert into a success instead of an error.
 */
export async function toggleCompletion({
  habitId,
  userId,
  date,
  completed,
}: ToggleCompletionInput): Promise<void> {
  if (completed) {
    const { error } = await supabase.from('habit_completions').insert({
      id: randomUUID(),
      habit_id: habitId,
      user_id: userId,
      completed_on: date,
    });
    if (error && error.code !== UNIQUE_VIOLATION) {
      throw error;
    }
  } else {
    const { error } = await supabase
      .from('habit_completions')
      .delete()
      .eq('habit_id', habitId)
      .eq('completed_on', date);
    if (error) {
      throw error;
    }
  }
}
