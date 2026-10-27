import { requireStaffScope } from "@/lib/auth/require-staff-scope";
import { AccessDenied } from "@/components/access-denied";

const AdminPage = async () => {
  if (!(await requireStaffScope("staff:admin:read"))) return <AccessDenied />;
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Staff administration</h1>
      <p>Administrative access is enabled for your account.</p>
    </main>
  );
};
export default AdminPage;
