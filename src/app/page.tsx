export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
        Web app starter
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Ready to build.
      </h1>
      <p className="max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        Next.js, TypeScript, Tailwind CSS, PostgreSQL, Drizzle, Vitest, and
        Playwright are configured. Start by editing{" "}
        <code>src/app/page.tsx</code>.
      </p>
    </main>
  );
}
