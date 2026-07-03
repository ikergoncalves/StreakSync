import { useEffect } from 'react';

import { supabase } from '../lib/supabase';
import { useGroupsStore } from '../store/groups';
import { ActivityEvent } from '../types';

/**
 * Live activity feed for the active group: subscribes to Postgres INSERTs on
 * activity_events filtered by group_id. Each new event is prepended to the
 * feed, and the members/leaderboard data is refetched wholesale — a peer's
 * streak changed, and refetching is the simplest correct answer (no
 * per-row streak patching).
 *
 * REQUIRES a one-time manual step in the Supabase dashboard: enable Realtime
 * for the activity_events table under Database -> Replication (adding the
 * table to the supabase_realtime publication). This cannot be done from a
 * migration file in this project's workflow. Delivery respects RLS, so
 * members only ever receive their own groups' events.
 */
export function useGroupRealtime(groupId: string | null): void {
  useEffect(() => {
    if (!groupId) {
      return;
    }
    const channel = supabase
      .channel(`group-activity-${groupId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_events',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const store = useGroupsStore.getState();
          store.ingestRealtimeEvent(payload.new as ActivityEvent);
          void store.loadMembers(groupId);
        },
      )
      .subscribe();

    // Tear the channel down when the active group changes or the screen
    // unmounts; otherwise every past group would keep streaming events.
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId]);
}
