const stack = [
  'React Native',
  'Expo',
  'Supabase',
  'TypeScript',
  'Zustand',
  'NativeWind',
  'React Navigation',
  'SQLite',
];

export default function TechStack() {
  return (
    <section
      aria-labelledby="stack-heading"
      className="bg-slate-50 px-6 py-16 dark:bg-slate-900/60"
    >
      <div className="mx-auto max-w-5xl text-center">
        <h2 id="stack-heading" className="text-3xl font-bold tracking-tight">
          Built with
        </h2>
        <ul className="mt-8 flex flex-wrap justify-center gap-3">
          {stack.map((tech) => (
            <li
              key={tech}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {tech}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
