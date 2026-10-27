import { LogoutButton } from "@/app/account/logout-button";

const AccessDenied = () => (
  <main className="mx-auto max-w-3xl space-y-4 px-6 py-16">
    <h1 className="text-3xl font-semibold">Access denied</h1>
    <p>Your account does not have permission to access this page.</p>
    <a
      className="text-blue-600 underline"
      href="/private/account/change-password"
    >
      Change your password
    </a>
    <LogoutButton audience="staff" />
  </main>
);
export { AccessDenied };
