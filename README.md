# StreakSync

Offline-first habit tracker with real-time social accountability. Built with React Native, Expo, and Supabase.

Create habits, check them off daily, and join groups where friends see each other's streaks in real time — with an activity feed and push notifications when someone keeps (or breaks) a streak.

## Tech stack

- **Mobile:** [React Native](https://reactnative.dev/) + [Expo](https://expo.dev/) (managed workflow), TypeScript strict
- **Backend:** [Supabase](https://supabase.com/) — Postgres, Auth, Realtime, Storage
- **Navigation:** [React Navigation](https://reactnavigation.org/) (native stack + bottom tabs)
- **Forms:** [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)
- **State:** [Zustand](https://zustand.docs.pmnd.rs/)
- **Styling:** [NativeWind](https://www.nativewind.dev/) (Tailwind CSS for React Native)
- **Testing:** Jest (jest-expo) + React Native Testing Library
- **CI:** GitHub Actions

## Local setup

### 1. Prerequisites

- Node.js 22+ and npm
- The [Expo Go](https://expo.dev/go) app on your phone (or an Android/iOS simulator)

### 2. Install dependencies

```bash
git clone <your-fork-or-clone-url>
cd StreakSync
npm install
```

### 3. Create the Supabase project

1. Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Apply the database migrations, in order, from `supabase/migrations/`:
   - **SQL editor (simplest):** open _SQL Editor_ in the dashboard and run the contents of each `NNNN_*.sql` file in ascending order (`0001_initial_schema.sql` through `0006_push_tokens.sql`).
   - **Supabase CLI (alternative):** `supabase link --project-ref <your-ref>` then `supabase db push`.
3. **Enable Realtime** for the activity feed: in the dashboard go to _Database → Replication_ and toggle on the `activity_events` table (this adds it to the `supabase_realtime` publication; it can't be done from a migration here). Without it the app still works, but group activity only appears after a manual refresh.

### 4. Configure the environment

```bash
cp .env.example .env
```

Fill in both values from _Project Settings → API_ in the Supabase dashboard:

- `EXPO_PUBLIC_SUPABASE_URL` — the Project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — the `anon` public key

### 5. Run the app

```bash
npm start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS). You can now sign up, create daily or weekly habits, check them off from the Today tab, and watch your streaks grow; the session persists across app restarts.

## Offline-first architecture

Personal data (habits and completions) works fully offline; groups, the activity feed, and the leaderboard require a connection by design.

- **Local SQLite mirror** (`expo-sqlite`): the UI reads and writes a local copy of `habits`/`habit_completions` — no network wait, ever. The schema is versioned via `PRAGMA user_version` so future releases migrate in place.
- **Sync queue**: every local write also enqueues a mutation row in the same SQLite transaction. The queue drains in order whenever connectivity returns, the app foregrounds, or a mutation happens online. Repeated offline toggles of the same habit/day collapse into one queued mutation. Rows that keep failing with a permanent error stop retrying after 5 attempts and surface a "sync issue" banner; network errors retry forever.
- **Conflict resolution — last-write-wins by `updated_at`**: when a queued edit reaches the server, the newer side (comparing the server row's `updated_at` against the local write time) wins, and the loser is overwritten. **Known limitation:** genuinely concurrent edits of the same habit from two devices can silently lose one side's change, and un-completing a day leaves no tombstone to compare against. This is a deliberate, industry-standard trade-off for a personal tracker where multi-device concurrent editing is rare.

On launch the app hydrates instantly from SQLite, then reconciles with the server in the background (server wins, except for entities with queued local changes).

> **Tip:** by default Supabase requires email confirmation on signup. For a faster dev loop you can disable it under _Authentication → Providers → Email → Confirm email_.

## Push notifications setup

Phase 5 adds two kinds of notifications:

- **Social pushes** — when a group member breaks a streak, or continues one onto a milestone (every 5th day/week; ordinary daily check-ins deliberately don't notify), the other members of their groups get a push. Sends are **device-to-device**: the acting user's phone posts directly to [Expo's push API](https://docs.expo.dev/push-notifications/sending-notifications/) for its peers right after its own completion finishes syncing — no server-side function. Like the activity feed, this is best-effort and online-only: if the acting device is offline at sync time, the push simply isn't sent.
- **Personal daily reminders** — each active **daily** habit that isn't checked off by 8:00 PM local time triggers a local notification (weekly habits are out of reminder scope for now; the reminder time becomes configurable in Phase 6). These are scheduled entirely on-device and work fully offline.

To set it up:

1. Apply migration `0006_push_tokens.sql` (see step 3 above) — it stores each device's Expo push token, readable only by that user's group peers.
2. **Use a physical device with a development build.** Remote push delivery is not supported in Expo Go on Android (since SDK 53), so real end-to-end push testing needs an EAS dev build: `npx eas build --profile development --platform android` (the project's `eas.json` and `expo-dev-client` are already configured). Local reminder notifications still work in Expo Go for basic testing; simulators get no push token at all (handled gracefully — the app works fully without one).
3. Notification permission is requested once after sign-in. Denying it is fine: habits, sync, and groups keep working; you just get no pushes or reminders.

## Scripts

| Command             | What it does              |
| ------------------- | ------------------------- |
| `npm start`         | Start the Expo dev server |
| `npm run lint`      | ESLint                    |
| `npm run format`    | Prettier (write)          |
| `npm run typecheck` | TypeScript, no emit       |
| `npm test`          | Jest unit tests           |

## Roadmap

- [x] **Phase 1 — Foundation:** Expo + Supabase setup, full database schema with RLS, email/password authentication with persisted sessions
- [x] **Phase 2 — Habits:** habit CRUD, daily completion with optimistic UI, timezone-safe streak calculation, tab navigation
- [x] **Phase 3 — Social:** groups, invite codes + `streaksync://join/<CODE>` deep links, realtime activity feed, leaderboard
- [x] **Phase 4 — Offline-first:** local SQLite mirror, sync queue with automatic drain on reconnect, last-write-wins conflict resolution
- [x] **Phase 5 — Notifications:** social pushes (streak broken / milestone) sent device-to-device via Expo Push, plus offline local daily reminders
- [ ] **Phase 6 — Polish:** animations, dark mode, onboarding
- [ ] **Phase 7 — Ship:** EAS Build, landing page, demo GIF

## License

[MIT](LICENSE)
