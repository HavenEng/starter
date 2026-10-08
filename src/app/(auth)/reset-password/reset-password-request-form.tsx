"use client";

import { sendPasswordResetEmail } from "firebase/auth";
import type { FormEvent } from "react";
import { useState } from "react";
import type { AuthAudience } from "@/lib/auth/audience";
import { getAuthPath } from "@/lib/auth/audience";
import { getFirebaseAuth } from "@/lib/firebase/client";

type ResetPasswordRequestFormProps = {
  audience?: AuthAudience;
};

function getRequestErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many requests. Wait a little while before trying again.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Authentication.";
    case "auth/operation-not-allowed":
      return "Enable Email/Password sign-in in the Firebase console first.";
    default:
      return "We could not send a reset email. Please try again.";
  }
}

const ResetPasswordRequestForm = ({
  audience = "user",
}: ResetPasswordRequestFormProps) => {
  const loginPath = getAuthPath(audience, "/login");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submittedEmail = String(formData.get("email") ?? "").trim();

    setEmail(submittedEmail);
    setError(null);
    setIsSubmitting(true);

    try {
      await sendPasswordResetEmail(getFirebaseAuth(audience), submittedEmail);
      setSent(true);
    } catch (submitError) {
      const code =
        typeof submitError === "object" &&
        submitError !== null &&
        "code" in submitError
          ? String(submitError.code)
          : "";

      // Keep the response the same for unknown accounts when enumeration
      // protection is disabled for this Firebase project.
      if (code === "auth/user-not-found") {
        setSent(true);
      } else {
        setError(getRequestErrorMessage(submitError));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
        Firebase Authentication
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Reset your password
      </h1>
      {sent ? (
        <>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            If an account uses {email}, you’ll receive an email with a password
            reset link shortly.
          </p>
          <a
            className="mt-6 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            href={loginPath}
          >
            Return to sign in
          </a>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Enter the email address for your account and we’ll send you a reset
            link.
          </p>
          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block space-y-2 text-sm font-medium">
              <span>Email</span>
              <input
                autoComplete="email"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700"
                defaultValue={email}
                name="email"
                required
                type="email"
              />
            </label>
            {error ? (
              <p
                aria-live="polite"
                className="text-sm text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            ) : null}
            <button
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            Remembered your password?{" "}
            <a
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              href={loginPath}
            >
              Sign in
            </a>
          </p>
        </>
      )}
    </div>
  );
};

export { ResetPasswordRequestForm };
