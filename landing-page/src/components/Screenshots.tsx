const slots = [
  'Today screen with habit check-offs',
  'Group leaderboard',
  'Real-time activity feed',
  'Onboarding intro',
];

export default function Screenshots() {
  return (
    <section aria-labelledby="screenshots-heading" className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <h2 id="screenshots-heading" className="text-center text-3xl font-bold tracking-tight">
          A look inside
        </h2>
        <div className="mt-10 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {/* TODO: replace each placeholder with a real screenshot:
              <img src="..." alt="..." className="aspect-[9/19.5] w-full rounded-3xl border border-slate-200 object-cover dark:border-slate-700" /> */}
          {slots.map((label) => (
            <div
              key={label}
              role="img"
              aria-label={`Placeholder for a screenshot: ${label}`}
              className="flex aspect-[9/19.5] items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="px-4 text-center text-sm text-slate-400 dark:text-slate-500">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
