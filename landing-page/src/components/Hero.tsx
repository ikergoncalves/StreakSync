import { APK_DOWNLOAD_URL } from '../links';

export default function Hero() {
  return (
    <header className="bg-gradient-to-b from-emerald-50 to-white px-6 pt-20 pb-16 dark:from-emerald-950/40 dark:to-slate-950">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl text-center md:text-left">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
            <span aria-hidden="true">🔥</span> Keep your streaks alive
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Streak<span className="text-accent">Sync</span>
          </h1>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
            Offline-first habit tracker with real-time social accountability.
          </p>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            Build habits, check them off anywhere — even with no signal — and let your friends see
            your streaks grow in real time.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row md:justify-start sm:justify-center">
            <a
              href={APK_DOWNLOAD_URL}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v12m0 0 4-4m-4 4-4-4m-4 8h16"
                />
              </svg>
              Download APK
            </a>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Android · free · no account needed to browse
            </span>
          </div>
        </div>
        {/* TODO: replace with a real app screenshot or device mockup */}
        <div
          role="img"
          aria-label="Placeholder for a StreakSync app screenshot"
          className="flex aspect-[9/19.5] w-56 shrink-0 items-center justify-center rounded-3xl border-4 border-slate-200 bg-slate-100 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          <span className="px-4 text-center text-sm text-slate-400 dark:text-slate-500">
            App screenshot coming soon
          </span>
        </div>
      </div>
    </header>
  );
}
