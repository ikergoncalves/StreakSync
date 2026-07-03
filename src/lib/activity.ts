import { randomUUID } from 'expo-crypto';

import { supabase } from './supabase';
import { ActivityEventData, ActivityEventWithProfile } from '../types';

/**
 * Latest activity for a group, newest first, with the actor's profile
 * embedded. Realtime INSERTs are prepended on top of this by the groups
 * store (see useGroupRealtime).
 */
export async function listActivityEvents(
  groupId: string,
  limit = 50,
): Promise<ActivityEventWithProfile[]> {
  const { data, error } = await supabase
    .from('activity_events')
    .select('*, profile:profiles(*)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as ActivityEventWithProfile[];
}

export interface InsertActivityEventInput {
  groupId: string;
  userId: string;
  event: ActivityEventData;
}

/** Thin insert wrapper; the id is client-generated like every other table. */
export async function insertActivityEvent({
  groupId,
  userId,
  event,
}: InsertActivityEventInput): Promise<void> {
  const { error } = await supabase.from('activity_events').insert({
    id: randomUUID(),
    group_id: groupId,
    user_id: userId,
    type: event.type,
    payload: event.payload,
  });
  if (error) {
    throw error;
  }
}
