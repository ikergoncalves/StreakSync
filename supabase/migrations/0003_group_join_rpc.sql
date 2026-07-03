-- Phase 3: join a group via its invite code.
--
-- Non-members cannot SELECT a group row (groups_select_member_or_owner in
-- 0002), and that stays true: opening groups up to arbitrary invite_code
-- lookups would let anyone brute-force codes and scrape group names. This
-- SECURITY DEFINER function is therefore the ONLY way a non-member joins:
-- it validates the code server-side and returns the group row only on
-- success.
--
-- Profile visibility for fellow members needs no new policy:
-- profiles_select_authenticated (0002) already lets any signed-in user read
-- any profile row, which covers leaderboards and activity feeds.
--
-- Reminder (manual step, not expressible here): for the Phase 3 realtime
-- feed, enable Realtime for public.activity_events in the Supabase
-- dashboard under Database -> Replication.

create or replace function public.join_group_by_invite_code(p_invite_code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.groups;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in to join a group.';
  end if;

  -- Codes are stored uppercase (generate_invite_code), but accept any case
  -- and surrounding whitespace from manual entry.
  select * into v_group
  from groups
  where upper(invite_code) = upper(trim(p_invite_code));

  if not found then
    raise exception 'Invalid invite code. Double-check it and try again.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, (select auth.uid()), 'member')
  on conflict do nothing;

  -- FOUND is false when the ON CONFLICT path ran, i.e. the caller was
  -- already a member: joining twice is a silent no-op and must not spam the
  -- feed with duplicate member_joined events.
  if found then
    insert into activity_events (id, group_id, user_id, type, payload)
    values (gen_random_uuid(), v_group.id, (select auth.uid()), 'member_joined', '{}'::jsonb);
  end if;

  return v_group;
end;
$$;

-- Functions are executable by PUBLIC by default; restrict to signed-in users.
revoke execute on function public.join_group_by_invite_code(text) from public, anon;
grant execute on function public.join_group_by_invite_code(text) to authenticated, service_role;
