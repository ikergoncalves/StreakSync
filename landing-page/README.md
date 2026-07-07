# StreakSync landing page

A static marketing site for [StreakSync](https://github.com/ikergoncalves/StreakSync) — no login, no backend connection, just a showcase of the app for visitors and recruiters. Built with Vite, React, TypeScript, and Tailwind CSS, completely isolated from the Expo app (its own `package.json` and dependencies).

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Outputs a static bundle to `dist/`.

## Deploy (Vercel)

Import the GitHub repo in the Vercel dashboard and set the project's **Root Directory** setting to `landing-page/` (a one-time manual step). Vercel auto-detects Vite from there — no other configuration needed.

## Before going live

- Replace `APK_DOWNLOAD_URL` in `src/links.ts` with the real EAS build link or a GitHub Releases asset URL.
- Replace the screenshot placeholders (marked with `TODO` comments in `src/components/Hero.tsx` and `src/components/Screenshots.tsx`) with real captures.
