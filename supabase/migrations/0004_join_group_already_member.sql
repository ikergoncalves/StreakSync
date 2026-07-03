-- Phase 3 fix: silent rejoin.
--
-- The 0003 version of join_group_by_invite_code returned the bare group row
-- whether or not the caller was already a member, so the client could not
-- tell a first join from a no-op rejoin and showed no feedback at all.
-- Replace it with a version returning jsonb: the group row plus an
-- already_member flag. (The return type changes, so the function must be
-- dropped and recreated — CREATE OR REPLACE cannot alter a return type.)
--
-- Everything else is unchanged from 0003: this stays the ONLY way a
-- non-member joins a group, rejoining stays a harmless no-op (now a visible
-- one), and member_joined is still only emitted for first-time joins.

drop function public.join_group_by_invite_code(text);

create function public.join_group_by_invite_code(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_already_member boolean;
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

  -- FOUND is false when the ON CONFLICT path swallowed the insert, i.e. the
  -- caller was already a member.
  v_already_member := not found;

  if not v_already_member then
    insert into activity_events (id, group_id, user_id, type, payload)
    values (gen_random_uuid(), v_group.id, (select auth.uid()), 'member_joined', '{}'::jsonb);
  end if;

  return jsonb_build_object('group', to_jsonb(v_group), 'already_member', v_already_member);
end;
$$;

-- Functions are executable by PUBLIC by default; restrict to signed-in users.
revoke execute on function public.join_group_by_invite_code(text) from public, anon;
grant execute on function public.join_group_by_invite_code(text) to authenticated, service_role;
