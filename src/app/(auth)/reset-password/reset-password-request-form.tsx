"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import type { AuthAudience } from "@/lib/auth/audience";
import { getAuthPath } from "@/lib/auth/audience";
import {
  AuthResponseError,
  reportUnexpectedError,
} from "@/lib/observability/report";

type ResetPasswordRequestFormProps = {
  audience?: AuthAudience;
};

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
      const response = await fetch(
        `/api/auth/${audience === "staff" ? "staff/" : ""}password-reset`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: submittedEmail }),
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        reportUnexpectedError(
          new AuthResponseError(
            "Password reset request failed",
            response.status,
            response.headers.get("x-request-id") ?? undefined,
            response.headers.get("x-sentry-event-id") ?? undefined,
          ),
          { operation: "auth.request-password-reset", audience },
        );
        setError(
          result?.error || "We could not send a reset email. Please try again.",
        );
        return;
      }
      setSent(true);
    } catch (submitError) {
      reportUnexpectedError(submitError, {
        operation: "auth.request-password-reset",
        audience,
      });
      setError("We could not send a reset email. Please try again.");
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
