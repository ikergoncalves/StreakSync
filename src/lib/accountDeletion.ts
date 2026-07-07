// Self-service account deletion (Phase 8). The server-side work is one call
// to the delete_own_account SECURITY DEFINER RPC (migration 0007), which is
// hard-scoped to auth.uid() — no client code path can name a different
// target, because the function takes no parameters at all.

import { GroupWithMemberCount, listGroupMembers, listMyGroups } from './groups';
import { isSoleOwner } from './membership';
import { supabase } from './supabase';

/**
 * Custom SQLSTATE raised by delete_own_account when the caller is the sole
 * owner of a shared group (see migration 0007). PostgREST forwards it as
 * PostgrestError.code, which is how the client tells "resolve your groups
 * first" apart from network or unexpected server failures.
 */
export const SOLE_OWNER_BLOCKED_CODE = 'SOWNR';

/** The RPC refused deletion because shared groups would be orphaned; the
 * message carries the offending group names from the server. */
export class SoleOwnerDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoleOwnerDeletionError';
  }
}

/**
 * Groups the user cannot abandon by deleting their account: they hold the
 * only owner role (same isSoleOwner rule as the Phase 3 leave-group check)
 * AND at least one other member would be stranded. Solo groups — the user
 * alone — never block: cascade-deleting them affects nobody else.
 *
 * The UI calls this BEFORE the RPC so the blocking groups can be listed in a
 * friendly alert instead of a raw server exception; the RPC re-checks
 * server-side as the unbypassable backstop.
 */
export async function listBlockingGroups(userId: string): Promise<GroupWithMemberCount[]> {
  const groups = await listMyGroups();
  const shared = groups.filter((group) => group.member_count > 1);
  const memberLists = await Promise.all(shared.map((group) => listGroupMembers(group.id)));
  return shared.filter((_, index) => isSoleOwner(memberLists[index], userId));
}

/**
 * Deletes the signed-in user's auth.users row via the RPC, cascading through
 * profiles to every owned row (0001 schema). Throws SoleOwnerDeletionError
 * for the blocking-groups refusal so callers can branch on it; every other
 * failure (network, unexpected server error) is rethrown as a plain Error.
 */
export async function deleteOwnAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_own_account');
  if (error) {
    if (error.code === SOLE_OWNER_BLOCKED_CODE) {
      throw new SoleOwnerDeletionError(error.message);
    }
    throw new Error(error.message);
  }
}
