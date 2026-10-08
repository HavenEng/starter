import type { Metadata } from "next";
import { ResetPasswordConfirmForm } from "./reset-password-confirm-form";

type ResetPasswordConfirmPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ResetPasswordConfirmPage = async ({
  searchParams,
}: ResetPasswordConfirmPageProps) => {
  const query = await searchParams;
  const mode = typeof query.mode === "string" ? query.mode : "";
  const oobCode = typeof query.oobCode === "string" ? query.oobCode : "";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      {mode === "resetPassword" && oobCode ? (
        <ResetPasswordConfirmForm oobCode={oobCode} />
      ) : (
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-3xl font-semibold tracking-tight">
            Reset link unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            This password reset link is incomplete. Request a new one to
            continue.
          </p>
          <a
            className="mt-6 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            href="/reset-password"
          >
            Request a new reset link
          </a>
        </div>
      )}
    </main>
  );
};

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default ResetPasswordConfirmPage;
