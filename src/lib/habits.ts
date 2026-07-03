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

/** Active habits for the signed-in user (RLS scopes the query), oldest first. */
export async function listHabits(): Promise<Habit[]> {
  const { data, error } = await supabase
    .from('habits')
    .select('*')
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

/** Completions for the signed-in user, oldest first, optionally date-bounded. */
export async function listCompletions(range: CompletionRange = {}): Promise<HabitCompletion[]> {
  let query = supabase.from('habit_completions').select('*');
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
