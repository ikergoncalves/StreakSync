-- Phase 3 fix: duplicate activity feed events.
--
-- Re-toggling a completion on/off/on within the same day used to emit a
-- fresh streak_continued row per toggle, and a double-fired create flow
-- could duplicate habit_created. The client now sends an event_date
-- (YYYY-MM-DD) in streak payloads and skips re-publishing within a session,
-- but the real guarantee lives here: partial unique indexes make the insert
-- itself idempotent (the client treats 23505 as a no-op), which is atomic —
-- unlike any client-side "check then insert", which races.
--
-- Deliberately NO index for member_joined: leaving a group and rejoining
-- later is a legitimate new feed event, so (group_id, user_id) must not be
-- unique forever. A true double-join is already impossible — group_members'
-- primary key (group_id, user_id) makes concurrent join RPCs conflict, and
-- the RPC only emits the event when its membership insert actually inserted
-- (FOUND-based guard in 0004). The only residual case is two concurrent
-- RPC calls racing a leave/rejoin boundary: rare and harmless enough that a
-- permanent constraint is not worth blocking legitimate rejoin events for.

-- Drop duplicates accumulated before this migration (keep the earliest of
-- each key) so the unique indexes can be created. Rows from before
-- event_date existed have a NULL key expression; they are left alone and
-- never conflict, because unique indexes treat NULLs as distinct.
delete from public.activity_events dup
using public.activity_events kept
where dup.group_id = kept.group_id
  and dup.type = kept.type
  and dup.type in ('habit_created', 'streak_continued', 'streak_broken')
  and dup.payload ->> 'habit_id' = kept.payload ->> 'habit_id'
  and (dup.type = 'habit_created' or dup.payload ->> 'event_date' = kept.payload ->> 'event_date')
  and (dup.created_at, dup.id) > (kept.created_at, kept.id);

-- A habit is created exactly once, ever: at most one event per group+habit.
create unique index activity_events_habit_created_unique
  on public.activity_events (group_id, ((payload ->> 'habit_id')))
  where type = 'habit_created';

-- At most one streak event per group, habit, type, and calendar date.
create unique index activity_events_streak_continued_unique
  on public.activity_events (group_id, ((payload ->> 'habit_id')), ((payload ->> 'event_date')))
  where type = 'streak_continued';

create unique index activity_events_streak_broken_unique
  on public.activity_events (group_id, ((payload ->> 'habit_id')), ((payload ->> 'event_date')))
  where type = 'streak_broken';
