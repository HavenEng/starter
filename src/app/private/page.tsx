import { LogoutButton } from "@/app/account/logout-button";
import { requireStaffUser } from "@/lib/auth/require-staff-user";

const PrivatePage = async () => {
  await requireStaffUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
        Staff portal
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Private area</h1>
      <p className="max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        This route is available to authenticated staff accounts.
      </p>
      <div>
        <LogoutButton audience="staff" />
      </div>
    </main>
  );
};

export default PrivatePage;
