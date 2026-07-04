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

export type GroupRole = 'owner' | 'member';

/** Row shape of public.groups. */
export interface Group {
  id: string;
  name: string;
  /** Short human-typeable code (e.g. A7K2M9XZ), unique per group. */
  invite_code: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

/** Row shape of public.group_members with the member's profile embedded. */
export interface GroupMember {
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
  profile: Profile;
}

/** Shared fields of every streak-related activity payload. */
export interface StreakEventHabit {
  habit_id: string;
  habit_name: string;
  habit_icon: string | null;
  frequency: HabitFrequency;
}

/**
 * Discriminated union of activity_events payload shapes, keyed by `type`
 * (matching the public.activity_event_type enum). `payload` is stored as
 * jsonb; these are the shapes the app writes and expects to read back.
 */
export type ActivityEventData =
  | {
      /** A completion increased the habit's current streak. */
      type: 'streak_continued';
      payload: StreakEventHabit & {
        current_streak: number;
        /** Local calendar date (YYYY-MM-DD) whose check-in caused the
         * increase — part of the dedup key (one event per habit per date,
         * enforced by migration 0005's partial unique index). */
        event_date: string;
      };
    }
  | {
      /** A streak that was >= 3 reset to 0 because a day/week was missed. */
      type: 'streak_broken';
      payload: StreakEventHabit & {
        previous_streak: number;
        /** Local calendar date (YYYY-MM-DD) the gap was observed; dedup key
         * like streak_continued's. */
        event_date: string;
      };
    }
  | {
      type: 'habit_created';
      payload: { habit_id: string; habit_name: string; habit_icon: string | null };
    }
  | {
      /** Who joined is the row's user_id; no extra payload. */
      type: 'member_joined';
      payload: Record<string, never>;
    };

/** Row shape of public.activity_events. */
export type ActivityEvent = ActivityEventData & {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
};

/** Feed row: the actor's profile is null until it can be resolved. */
export type ActivityEventWithProfile = ActivityEvent & { profile: Profile | null };
