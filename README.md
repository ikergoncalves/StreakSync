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
   - **SQL editor (simplest):** open _SQL Editor_ in the dashboard and run the contents of each `NNNN_*.sql` file in ascending order (`0001_initial_schema.sql` through `0005_activity_event_dedup.sql`).
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

> **Tip:** by default Supabase requires email confirmation on signup. For a faster dev loop you can disable it under _Authentication → Providers → Email → Confirm email_.

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
- [ ] **Phase 4 — Offline-first:** local SQLite, sync queue, conflict resolution
- [ ] **Phase 5 — Notifications:** push notifications via Expo Push
- [ ] **Phase 6 — Polish:** animations, dark mode, onboarding
- [ ] **Phase 7 — Ship:** EAS Build, landing page, demo GIF

## License

[MIT](LICENSE)
