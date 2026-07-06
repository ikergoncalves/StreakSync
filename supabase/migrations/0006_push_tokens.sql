-- Phase 5: Expo push token storage.
--
-- Social push notifications are sent DEVICE-TO-DEVICE: the acting user's
-- phone posts directly to Expo's public push API for its group peers, right
-- after its own activity event is confirmed synced (no Edge Function, no
-- pg_net trigger — consistent with the client + migrations architecture of
-- the rest of the app). That design needs exactly one thing from the
-- database: a place where each device publishes its Expo push token so that
-- fellow group members can read it at send time.

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- One row per token: an Expo push token identifies a device+app install,
  -- so registration upserts on this column (a re-registered device updates
  -- its existing row instead of accumulating duplicates).
  token text not null unique,
  -- Informational only (e.g. "Pixel 8"), never used for routing.
  device_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger push_tokens_set_updated_at
  before update on public.push_tokens
  for each row execute function public.set_updated_at();

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Why letting group peers SELECT each other's tokens is safe: an Expo push
-- token is a send-only address. Holding someone's token lets you ask Expo to
-- deliver a notification to their device — it grants no read access to any
-- of their data, cannot be exchanged for a session, and Expo rotates it when
-- the app is reinstalled. Exposure is further limited to fellow group
-- members (shares_group_with), i.e. people the user explicitly joined a
-- group with — not arbitrary authenticated users. This is exactly the grant
-- the device-to-device send path needs and nothing more.
create policy "push_tokens_select_own_or_group_peers"
  on public.push_tokens
  for select
  to authenticated
  using (user_id = (select auth.uid()) or public.shares_group_with(user_id));

create policy "push_tokens_insert_own"
  on public.push_tokens
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "push_tokens_update_own"
  on public.push_tokens
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- DELETE additionally allows group peers, not just the owner: when a send
-- gets a DeviceNotRegistered receipt from Expo (app uninstalled, token
-- rotated), it is the SENDER's device that observes it, so the sender must
-- be able to clean up the dead row. Worst case a malicious peer deletes a
-- live token — the only effect is missed notifications until the victim's
-- next app launch, which re-registers the token.
create policy "push_tokens_delete_own_or_group_peers"
  on public.push_tokens
  for delete
  to authenticated
  using (user_id = (select auth.uid()) or public.shares_group_with(user_id));
