/** Row shape of public.profiles (see supabase/migrations/0001_initial_schema.sql). */
export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type HabitFrequency = 'daily' | 'weekly';

/** Row shape of public.habits (see supabase/migrations/0001_initial_schema.sql). */
export interface Habit {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  frequency: HabitFrequency;
  /** Only meaningful when frequency is 'weekly'; 1–7. */
  target_days_per_week: number | null;
  created_at: string;
  updated_at: string;
  /** Soft-delete marker; deleted habits stay in the table for Phase 4 sync. */
  deleted_at: string | null;
}

/** Row shape of public.habit_completions. */
export interface HabitCompletion {
  id: string;
  habit_id: string;
  user_id: string;
  /** Local calendar date as YYYY-MM-DD (Postgres `date`). */
  completed_on: string;
  created_at: string;
  updated_at: string;
}
