// Pure membership-role logic, kept free of supabase imports so screens and
// the data layer can share the same check (and tests need no mocks).

import { GroupMember } from '../types';

/**
 * True when userId holds an owner role and nobody else does. Sole owners
 * cannot leave a group (it would be left unmanageable) — they delete it
 * instead.
 */
export function isSoleOwner(
  members: Pick<GroupMember, 'user_id' | 'role'>[],
  userId: string,
): boolean {
  const owners = members.filter((member) => member.role === 'owner');
  return owners.length > 0 && owners.every((owner) => owner.user_id === userId);
}
