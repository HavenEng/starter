import { redirect } from "next/navigation";
import { AuthForm } from "../auth-form";
import { getCurrentUser } from "@/lib/auth/session";

const SignupPage = async () => {
  if (await getCurrentUser()) {
    redirect("/account");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <AuthForm mode="signup" />
    </main>
  );
};

export default SignupPage;
