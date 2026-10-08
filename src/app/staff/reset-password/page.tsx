import { ResetPasswordRequestForm } from "@/app/(auth)/reset-password/reset-password-request-form";

const StaffResetPasswordPage = () => (
  <main className="flex min-h-screen items-center justify-center px-6 py-12">
    <ResetPasswordRequestForm audience="staff" />
  </main>
);

export default StaffResetPasswordPage;
