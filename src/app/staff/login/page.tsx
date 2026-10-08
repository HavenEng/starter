import { redirect } from "next/navigation";
import { AuthForm } from "@/app/(auth)/auth-form";
import { getCurrentStaffUser } from "@/lib/auth/session";

const StaffLoginPage = async () => {
  if (await getCurrentStaffUser()) {
    redirect("/private");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <AuthForm audience="staff" mode="login" />
    </main>
  );
};

export default StaffLoginPage;
