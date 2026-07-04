import { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect } from 'react';

import { supabase } from '../lib/supabase';
import { useGroupsStore } from '../store/groups';
import { ActivityEvent } from '../types';

// In-flight subscribe flows keyed by topic. Two overlapping effect runs for
// the same topic (e.g. two mounted hook instances, or effects firing in the
// same commit while activeGroupId settles right after creating a group) must
// never scan-and-create concurrently: both would pass the stale-channel scan
// below before either has created its channel, and the loser would then get
// the winner's already-subscribed instance back from supabase.channel().
// Each run therefore chains behind the previous run for its topic, so by the
// time it scans, the earlier run has fully claimed (or released) the topic.
const pendingByTopic = new Map<string, Promise<void>>();

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

    const topic = `group-activity-${groupId}`;
    // Owned by this effect run only. Kept in the effect closure (not a ref a
    // later run could clobber) so an out-of-order cleanup always removes
    // exactly the channel it created, never a newer run's.
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const subscribe = async () => {
      if (cancelled) {
        // Cleanup ran while this run was queued behind an earlier one; a
        // newer run (or none) owns the topic now — touch nothing.
        return;
      }
      // supabase.channel(topic) returns the EXISTING instance while a channel
      // with the same topic is still tracked by the client — including one
      // whose removeChannel() from a previous effect run has not completed
      // yet (removal is async). Calling .on() on that already-subscribed
      // instance throws "cannot add 'postgres_changes' callbacks for
      // realtime:<topic> after 'subscribe()'". So: defensively remove every
      // tracked channel for this topic and WAIT for the removals to finish
      // before creating a fresh channel.
      const stale = supabase
        .getChannels()
        // The client stores topics with a "realtime:" prefix; match the bare
        // form too in case that internal detail changes.
        .filter((tracked) => tracked.topic === `realtime:${topic}` || tracked.topic === topic);
      await Promise.all(stale.map((tracked) => supabase.removeChannel(tracked)));
      if (cancelled) {
        return;
      }

      channel = supabase
        .channel(topic)
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
    };

    // Chain behind any in-flight run for this topic (see pendingByTopic).
    const previous = pendingByTopic.get(topic) ?? Promise.resolve();
    const current: Promise<void> = previous
      .then(subscribe)
      .catch((error) => {
        // A failed subscription must not crash the screen or become an
        // unhandled rejection: the feed just isn't live for this group
        // (pull-to-refresh keeps working).
        console.warn(`Realtime subscription failed for ${topic}`, error);
      })
      .finally(() => {
        // Only the latest run for the topic clears the map entry.
        if (pendingByTopic.get(topic) === current) {
          pendingByTopic.delete(topic);
        }
      });
    pendingByTopic.set(topic, current);

    // Tear the channel down when the active group changes or the screen
    // unmounts; otherwise every past group would keep streaming events.
    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel).catch(() => undefined);
      }
    };
  }, [groupId]);
}
