-- StreakSync initial database schema.
--
-- Designed with offline-first sync (Phase 4) in mind:
--   * all primary keys are UUIDs so they can be generated client-side,
--   * every mutable table carries an updated_at column maintained by a trigger,
--   * user-owned content uses soft deletes (deleted_at) so deletions can sync.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.habit_frequency as enum ('daily', 'weekly');

create type public.group_role as enum ('owner', 'member');

create type public.activity_event_type as enum (
  'streak_continued',
  'streak_broken',
  'habit_created',
  'member_joined'
);

-- ---------------------------------------------------------------------------
-- Shared trigger function: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- Usernames are stored lowercased; the check constraint only matches
-- lowercase characters, which enforces case-insensitive uniqueness without
-- needing the citext extension.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user signs up. The username
-- comes from the signup metadata; if it is missing or already taken we fall
-- back to a sanitized/suffixed candidate so signup never fails.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  attempt int := 0;
begin
  base := lower(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(new.email, '@', 1)
  ));
  base := regexp_replace(base, '[^a-z0-9_]', '', 'g');
  if char_length(base) < 3 then
    base := 'user' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  base := substr(base, 1, 20);
  candidate := base;
  loop
    begin
      insert into public.profiles (id, username, display_name)
      values (
        new.id,
        candidate,
        coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), candidate)
      );
      return new;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt > 20 then
        raise;
      end if;
      candidate := substr(base, 1, 20 - char_length(attempt::text)) || attempt::text;
    end;
  end loop;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- habits
-- ---------------------------------------------------------------------------

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text,
  icon text,
  color text,
  frequency public.habit_frequency not null default 'daily',
  target_days_per_week int check (target_days_per_week between 1 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger habits_set_updated_at
  before update on public.habits
  for each row execute function public.set_updated_at();

create index habits_user_id_idx on public.habits (user_id);

-- ---------------------------------------------------------------------------
-- habit_completions
-- ---------------------------------------------------------------------------

create table public.habit_completions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  completed_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, completed_on)
);

create trigger habit_completions_set_updated_at
  before update on public.habit_completions
  for each row execute function public.set_updated_at();

-- The unique constraint above already indexes (habit_id, completed_on).
create index habit_completions_user_id_completed_on_idx
  on public.habit_completions (user_id, completed_on);

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------

-- Short, human-shareable invite code. The alphabet omits easily confused
-- characters (I, O, 0, 1).
create or replace function public.generate_invite_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1),
    ''
  )
  from generate_series(1, 8);
$$;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 50),
  invite_code text not null unique default public.generate_invite_code(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_id_idx on public.group_members (user_id);

-- ---------------------------------------------------------------------------
-- activity_events
-- ---------------------------------------------------------------------------

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.activity_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_events_group_id_created_at_idx
  on public.activity_events (group_id, created_at desc);
