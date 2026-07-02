-- StreakSync Row Level Security.
--
-- Every table is locked down by default; access is granted through the
-- policies below. Membership checks go through SECURITY DEFINER helper
-- functions so that policies on group_members never recurse into
-- group_members' own RLS policies.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from group_members
    where group_id = gid
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_group_owner(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from groups
    where id = gid
      and owner_id = (select auth.uid())
  );
$$;

-- True when the current user shares at least one group with other_user.
-- Used to let group peers see each other's habits and completions.
create or replace function public.shares_group_with(other_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from group_members mine
    join group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other_user
  );
$$;

revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.is_group_owner(uuid) from public, anon;
revoke execute on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated, service_role;
grant execute on function public.is_group_owner(uuid) to authenticated, service_role;
grant execute on function public.shares_group_with(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.habits enable row level security;
alter table public.habit_completions enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.activity_events enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- Profiles are visible to any signed-in user (needed for usernames in
-- groups, leaderboards, and activity feeds).
create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT/DELETE policies: profile rows are created by the
-- handle_new_user trigger (SECURITY DEFINER) and removed via the
-- ON DELETE CASCADE from auth.users.

-- ---------------------------------------------------------------------------
-- habits
-- ---------------------------------------------------------------------------

create policy "habits_crud_own"
  on public.habits
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Group peers can see each other's habits (read-only) for the social
-- features arriving in Phase 3.
create policy "habits_select_group_peers"
  on public.habits
  for select
  to authenticated
  using (public.shares_group_with(user_id));

-- ---------------------------------------------------------------------------
-- habit_completions
-- ---------------------------------------------------------------------------

create policy "habit_completions_crud_own"
  on public.habit_completions
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "habit_completions_select_group_peers"
  on public.habit_completions
  for select
  to authenticated
  using (public.shares_group_with(user_id));

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------

create policy "groups_select_member_or_owner"
  on public.groups
  for select
  to authenticated
  using (owner_id = (select auth.uid()) or public.is_group_member(id));

create policy "groups_insert_as_owner"
  on public.groups
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "groups_update_owner"
  on public.groups
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "groups_delete_owner"
  on public.groups
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------

create policy "group_members_select_own_groups"
  on public.group_members
  for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_group_member(group_id));

-- Phase 1 baseline: users may only insert THEMSELVES, and may only take the
-- 'owner' role in groups they actually own. Phase 3 replaces direct joins
-- with an invite-code RPC and may tighten this further.
create policy "group_members_insert_self"
  on public.group_members
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (role = 'member' or public.is_group_owner(group_id))
  );

-- Members can leave; owners can remove members.
create policy "group_members_delete_self_or_owner"
  on public.group_members
  for delete
  to authenticated
  using (user_id = (select auth.uid()) or public.is_group_owner(group_id));

-- ---------------------------------------------------------------------------
-- activity_events
-- ---------------------------------------------------------------------------

create policy "activity_events_select_members"
  on public.activity_events
  for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "activity_events_insert_members"
  on public.activity_events
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_group_member(group_id)
  );
