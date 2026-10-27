import { requireStaffUser } from "@/lib/auth/require-staff-user";
import { PasswordChangeForm } from "@/components/password-change-form";
const ChangePasswordPage = async () => {
  await requireStaffUser();
  return <PasswordChangeForm audience="staff" />;
};
export default ChangePasswordPage;
