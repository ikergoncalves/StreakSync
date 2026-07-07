import type { ReactNode } from 'react';

function FeatureIcon({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-accent dark:bg-emerald-900/50 dark:text-emerald-400"
    >
      {children}
    </div>
  );
}

const iconProps = {
  className: 'h-6 w-6',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 2,
} as const;

const features = [
  {
    title: 'Habits with streaks',
    description:
      'Create daily or weekly habits, check them off with one tap, and watch timezone-safe streaks grow.',
    icon: (
      <svg {...iconProps}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
    ),
  },
  {
    title: 'Social accountability',
    description:
      'Join groups with invite codes and see a real-time activity feed and leaderboard of everyone’s streaks.',
    icon: (
      <svg {...iconProps}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
        />
      </svg>
    ),
  },
  {
    title: 'Works fully offline',
    description:
      'A local SQLite mirror and sync queue mean your habits load instantly and every check-in syncs when you’re back online.',
    icon: (
      <svg {...iconProps}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
        />
      </svg>
    ),
  },
  {
    title: 'Push notifications',
    description:
      'Get nudged when a friend hits a milestone or breaks a streak, plus a local evening reminder for unfinished habits.',
    icon: (
      <svg {...iconProps}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
        />
      </svg>
    ),
  },
];

export default function Features() {
  return (
    <section aria-labelledby="features-heading" className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <h2 id="features-heading" className="text-center text-3xl font-bold tracking-tight">
          Everything a habit needs to stick
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title}>
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <h3 className="text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
