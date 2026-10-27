import { LogoutButton } from "@/app/account/logout-button";
import { requireStaffScope } from "@/lib/auth/require-staff-scope";
import { AccessDenied } from "@/components/access-denied";

const PrivatePage = async () => {
  if (!(await requireStaffScope("staff:portal:read"))) return <AccessDenied />;

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
        <a
          className="mr-4 text-blue-600 underline"
          href="/private/account/change-password"
        >
          Change password
        </a>
        <LogoutButton audience="staff" />
      </div>
    </main>
  );
};

export default PrivatePage;
