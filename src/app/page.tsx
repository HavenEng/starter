const Home = () => {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-4">
        <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
          Next.js project starter
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          User and staff authentication
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          A starter for email/password accounts with separate Firebase projects
          and PostgreSQL records for regular users and staff. Staff-only pages
          live under <code>/private</code>.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-8">
        <div className="space-y-2">
          <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
            Services
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Authentication setup
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Configure these two Firebase projects before enabling sign-in:
          </p>
        </div>

        <ol className="mt-6 space-y-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          <li>
            <strong>Create the projects.</strong> Make one Firebase project for
            regular users and one for staff. Register a Web app in each, enable
            Email/Password only, and authorize localhost plus your deployed
            domains.
          </li>
          <li>
            <strong>Add configuration.</strong> Copy
            <code>.env.example</code> to <code>.env.local</code>, then add both
            Web app configs and both server-only Admin service account
            credentials. Add the same values in Vercel; keep Admin keys private.
          </li>
          <li>
            <strong>Set reset email links.</strong> In each project’s Auth email
            template, point the reset action URL to{" "}
            <code>/reset-password/confirm</code> for users or{" "}
            <code>/staff/reset-password/confirm</code> for staff.
          </li>
          <li>
            <strong>Provision staff.</strong> Create staff accounts in the staff
            Firebase project and add their Firebase UIDs to{" "}
            <code>staff_users</code> after applying the database migrations.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Run locally</h2>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          After installing dependencies and filling in <code>.env.local</code>,
          start PostgreSQL, apply migrations, and launch the app:
        </p>
        <pre className="overflow-x-auto rounded-xl bg-zinc-100 p-4 text-sm leading-6 dark:bg-zinc-900">
          <code>{`docker compose up -d --wait
pnpm db:migrate
pnpm dev`}</code>
        </pre>
      </section>

      <nav aria-label="Authentication pages" className="flex flex-wrap gap-3">
        <a
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          href="/signup"
        >
          Create a user account
        </a>
        <a
          className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          href="/login"
        >
          User sign in
        </a>
        <a
          className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          href="/staff/login"
        >
          Staff sign in
        </a>
      </nav>
    </main>
  );
};

export default Home;
