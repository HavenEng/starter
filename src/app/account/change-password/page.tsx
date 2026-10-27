import { requireUser } from "@/lib/auth/require-user";
import { PasswordChangeForm } from "@/components/password-change-form";
const ChangePasswordPage = async () => {
  await requireUser();
  return <PasswordChangeForm audience="user" />;
};
export default ChangePasswordPage;
