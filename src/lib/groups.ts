import { randomUUID } from 'expo-crypto';

import { isSoleOwner } from './membership';
import { supabase } from './supabase';
import { Group, GroupMember, Habit, HabitCompletion } from '../types';

/** A group row plus how many members it has (used for the selector UI and to
 * skip activity emission in groups where the user is alone). */
export interface GroupWithMemberCount extends Group {
  member_count: number;
}

interface GroupCountRow extends Group {
  group_members: { count: number }[];
}

/** Groups the signed-in user owns or belongs to (RLS scopes the query). */
export async function listMyGroups(): Promise<GroupWithMemberCount[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('*, group_members(count)')
    .order('created_at', { ascending: true });
  if (error) {
    throw error;
  }
  return ((data ?? []) as GroupCountRow[]).map(({ group_members, ...group }) => ({
    ...group,
    member_count: group_members[0]?.count ?? 0,
  }));
}

/**
 * Creates a group and enrolls the caller as its owner member in one flow
 * (there is no DB trigger doing this). The id is client-generated for Phase 4
 * offline sync; the invite code comes from the DB default.
 */
export async function createGroup(userId: string, name: string): Promise<Group> {
  const { data, error } = await supabase
    .from('groups')
    .insert({ id: randomUUID(), name, owner_id: userId })
    .select()
    .single();
  if (error) {
    throw error;
  }
  const group = data as Group;

  const { error: memberError } = await supabase
    .from('group_members')
    .insert({ group_id: group.id, user_id: userId, role: 'owner' });
  if (memberError) {
    // Don't leave an orphan group the owner isn't a member of; best-effort
    // cleanup before surfacing the original failure.
    await supabase.from('groups').delete().eq('id', group.id);
    throw memberError;
  }
  return group;
}

export interface JoinGroupResult {
  group: Group;
  /** True when the code was valid but the caller already belonged to the
   * group — the join was a no-op, not a new membership. */
  alreadyMember: boolean;
}

/**
 * Joins a group via its invite code. This calls the SECURITY DEFINER RPC
 * from migration 0004 (0003 reworked) — the groups SELECT policy
 * deliberately does not allow looking up arbitrary groups by code from the
 * client.
 */
export async function joinGroupByInviteCode(code: string): Promise<JoinGroupResult> {
  const { data, error } = await supabase.rpc('join_group_by_invite_code', {
    p_invite_code: code.trim(),
  });
  if (error) {
    throw new Error(error.message);
  }
  const result = data as { group: Group; already_member: boolean };
  return { group: result.group, alreadyMember: result.already_member };
}

/** Members of a group with their profiles, oldest joiner first. */
export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id, user_id, role, joined_at, profile:profiles(*)')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true });
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as GroupMember[];
}

export interface MemberHabitData {
  habits: Habit[];
  completions: HabitCompletion[];
}

/**
 * Habits and completions for a set of users (group peers — readable via the
 * shares_group_with RLS policies). Feeds the leaderboard's streak sums, which
 * need full completion history to compute current streaks.
 */
export async function listMemberHabitData(userIds: string[]): Promise<MemberHabitData> {
  if (userIds.length === 0) {
    return { habits: [], completions: [] };
  }
  const [habitsResult, completionsResult] = await Promise.all([
    supabase.from('habits').select('*').in('user_id', userIds).is('deleted_at', null),
    supabase
      .from('habit_completions')
      .select('*')
      .in('user_id', userIds)
      .order('completed_on', { ascending: true }),
  ]);
  if (habitsResult.error) {
    throw habitsResult.error;
  }
  if (completionsResult.error) {
    throw completionsResult.error;
  }
  return {
    habits: (habitsResult.data ?? []) as Habit[],
    completions: (completionsResult.data ?? []) as HabitCompletion[],
  };
}

export const SOLE_OWNER_MESSAGE =
  'You are the only owner of this group. Delete the group instead, or transfer ownership first.';

/**
 * Removes the signed-in user from a group. Blocked when they are the sole
 * owner: the group would be left without anyone who can manage it. (The UI
 * offers deleteGroup instead in that case; this server check is the
 * backstop.)
 */
export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id, role')
    .eq('group_id', groupId)
    .eq('role', 'owner');
  if (error) {
    throw error;
  }
  if (isSoleOwner((data ?? []) as Pick<GroupMember, 'user_id' | 'role'>[], userId)) {
    throw new Error(SOLE_OWNER_MESSAGE);
  }

  const { error: deleteError } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (deleteError) {
    throw deleteError;
  }
}

/**
 * Hard-deletes a group. Unlike habits there is no soft delete: groups and
 * their memberships/feed are not part of the Phase 4 offline-sync scope, and
 * group_members plus activity_events cascade on groups.id (0001 schema), so
 * removing the group row is sufficient. Only the owner can do this — the
 * groups_delete_owner RLS policy (0002) enforces it server-side; for anyone
 * else the delete simply matches no rows.
 */
export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  if (error) {
    throw error;
  }
}
