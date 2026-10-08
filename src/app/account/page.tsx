import { requireUser } from "@/lib/auth/require-user";
import { LogoutButton } from "./logout-button";

const AccountPage = async () => {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
        Signed in
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Your account</h1>
      <dl className="space-y-2 text-zinc-600 dark:text-zinc-400">
        <div>
          <dt className="inline font-medium text-zinc-900 dark:text-zinc-100">
            Email:{" "}
          </dt>
          <dd className="inline">{user.email ?? "No email on this account"}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-zinc-900 dark:text-zinc-100">
            Firebase UID:{" "}
          </dt>
          <dd className="inline">{user.firebaseUid}</dd>
        </div>
      </dl>
      <div>
        <LogoutButton />
      </div>
    </main>
  );
};

export default AccountPage;
