-- Phase 8: self-service account deletion.
--
-- WHY THIS IS SAFE WITHOUT AN EDGE FUNCTION OR SERVICE-ROLE KEY
-- Deleting a row from auth.users normally requires elevated privileges that
-- the client's anon/authenticated role must never hold. This function is
-- SECURITY DEFINER and is created by the elevated role running the SQL
-- Editor (postgres), so its body executes with that owner's privileges —
-- the same pattern as join_group_by_invite_code (0003). It stays safe
-- because it takes NO parameters and is hard-scoped to auth.uid(): there is
-- no way for a caller to name a different target, so the most any attacker
-- with a stolen session can do is delete the account that session already
-- controls.
--
-- WHAT THE DELETE CASCADES TO
-- profiles.id references auth.users(id) ON DELETE CASCADE (0001), and every
-- user-owned table (habits, habit_completions, groups.owner_id,
-- group_members, activity_events, push_tokens) cascades from profiles.id in
-- turn. One DELETE on auth.users therefore removes every server-side trace
-- of the account.
--
-- THE SOLE-OWNER GUARD
-- Because groups.owner_id cascades too, deleting a user silently destroys
-- every group they own — including groups OTHER people are still using.
-- That reuses the Phase 3 rule ("a sole owner cannot take the destructive
-- action that would strand the group") applied to account deletion: if the
-- caller is the only owner of any group that still has other members, the
-- deletion is refused. Solo groups (member_count == 1, just the caller) are
-- allowed to cascade away silently — nobody else is affected, and forcing
-- the user to delete them one by one first would be pure friction.
--
-- ERROR CONTRACT WITH THE CLIENT
-- The blocking case raises with the custom SQLSTATE 'SOWNR' and puts the
-- offending group names in the message. A plain exception CAN carry this
-- cleanly: PostgREST forwards both the SQLSTATE (PostgrestError.code) and
-- the message, so the client branches on the stable code and can show the
-- names verbatim — no structured return type needed for an error path. The
-- app additionally pre-checks via listBlockingGroups() for friendlier UX;
-- this server-side check is the backstop that makes the rule impossible to
-- bypass.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_blocking_names text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to delete your account.';
  end if;

  -- Groups where the caller holds the only owner role AND at least one other
  -- member exists (the same sole-owner definition as isSoleOwner in the app,
  -- combined with member_count > 1).
  select string_agg('"' || g.name || '"', ', ' order by g.name)
  into v_blocking_names
  from groups g
  where exists (
      select 1 from group_members gm
      where gm.group_id = g.id and gm.user_id = v_user_id and gm.role = 'owner'
    )
    and not exists (
      select 1 from group_members gm
      where gm.group_id = g.id and gm.user_id <> v_user_id and gm.role = 'owner'
    )
    and (select count(*) from group_members gm where gm.group_id = g.id) > 1;

  if v_blocking_names is not null then
    raise exception 'You are the only owner of shared groups that still have other members: %. Delete those groups first.',
      v_blocking_names
      using errcode = 'SOWNR';
  end if;

  delete from auth.users where id = v_user_id;
end;
$$;

-- Functions are executable by PUBLIC by default; restrict to signed-in users.
revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated, service_role;
