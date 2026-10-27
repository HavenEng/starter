"use client";

import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { LogoutButton } from "@/app/account/logout-button";
import type { AuthAudience } from "@/lib/auth/audience";
import { getAuthPath } from "@/lib/auth/audience";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { reportUnexpectedError } from "@/lib/observability/report";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  PASSWORD_LENGTH_MESSAGE,
} from "@/lib/auth/password-policy";

type ResetPasswordConfirmFormProps = {
  oobCode: string;
  audience?: AuthAudience;
};

type VerificationState =
  "checking" | "ready" | "invalid" | "complete" | "unconfirmed";

const RESET_CONFIRMATION_TIMEOUT_MS = 30_000;
const unconfirmedMessage =
  "We couldn’t confirm the password update. Please sign in to continue.";

function getFirebaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
}

function getConfirmErrorMessage(error: unknown) {
  const code = getFirebaseErrorCode(error);

  switch (code) {
    case "auth/expired-action-code":
    case "auth/invalid-action-code":
      return "This reset link is invalid or has expired. Request a new one.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a password that meets the password requirements.";
    case "auth/too-many-requests":
      return "Too many requests";
    default:
      return unconfirmedMessage;
  }
}

function getVerificationErrorMessage(error: unknown) {
  const code = getFirebaseErrorCode(error);

  return code === "auth/expired-action-code" ||
    code === "auth/invalid-action-code"
    ? "This reset link is invalid or has expired. Request a new one."
    : "We could not check this link. Check your connection and try again.";
}

const ResetPasswordConfirmForm = ({
  oobCode,
  audience = "user",
}: ResetPasswordConfirmFormProps) => {
  const resetPath = getAuthPath(audience, "/reset-password");
  const [verification, setVerification] =
    useState<VerificationState>("checking");
  const [email, setEmail] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;

    const verifyCode = async () => {
      try {
        const verifiedEmail = await verifyPasswordResetCode(
          getFirebaseAuth(audience),
          oobCode,
        );
        if (!active) return;
        setEmail(verifiedEmail);
        setVerification("ready");
      } catch (verifyError) {
        if (!active) return;
        reportUnexpectedError(verifyError, {
          operation: "auth.verify-password-reset",
          audience,
        });
        setVerificationError(getVerificationErrorMessage(verifyError));
        setVerification("invalid");
      }
    };

    void verifyCode();

    return () => {
      active = false;
    };
  }, [audience, oobCode]);

  const handleVerifyAgain = async () => {
    setVerification("checking");
    setVerificationError("");
    try {
      const verifiedEmail = await verifyPasswordResetCode(
        getFirebaseAuth(audience),
        oobCode,
      );
      setEmail(verifiedEmail);
      setVerification("ready");
    } catch (verifyError) {
      reportUnexpectedError(verifyError, {
        operation: "auth.verify-password-reset",
        audience,
      });
      setVerificationError(getVerificationErrorMessage(verifyError));
      setVerification("invalid");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || verification !== "ready") return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const password = String(formData.get("password") ?? "");
    const passwordConfirmation = String(
      formData.get("passwordConfirmation") ?? "",
    );

    setError(null);
    if (
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      setError(PASSWORD_LENGTH_MESSAGE);
      return;
    }
    if (password !== passwordConfirmation) {
      setError("The passwords do not match.");
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // The SDK cannot cancel this mutation. Racing the UI timeout leaves any
      // late provider result unable to replace recovery or trigger another reset.
      await Promise.race([
        confirmPasswordReset(getFirebaseAuth(audience), oobCode, password),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Password reset confirmation timed out.")),
            RESET_CONFIRMATION_TIMEOUT_MS,
          );
        }),
      ]);
      form.reset();
      setVerification("complete");
    } catch (submitError) {
      reportUnexpectedError(submitError, {
        operation: "auth.confirm-password-reset",
        audience,
      });
      const code = getFirebaseErrorCode(submitError);
      if (
        [
          "auth/weak-password",
          "auth/password-does-not-meet-requirements",
          "auth/too-many-requests",
        ].includes(code)
      ) {
        setError(getConfirmErrorMessage(submitError));
      } else {
        form.reset();
        if (
          ["auth/expired-action-code", "auth/invalid-action-code"].includes(
            code,
          )
        ) {
          setVerificationError(getConfirmErrorMessage(submitError));
          setVerification("invalid");
        } else {
          setVerification("unconfirmed");
        }
      }
    } finally {
      clearTimeout(timeout);
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
        Firebase Authentication
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        {verification === "complete"
          ? "Password updated"
          : verification === "unconfirmed"
            ? "Sign in again"
            : "Choose a new password"}
      </h1>
      {verification === "checking" ? (
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Checking your password reset link…
        </p>
      ) : verification === "invalid" ? (
        <>
          <p
            aria-live="polite"
            className="mt-3 text-sm leading-6 text-red-600 dark:text-red-400"
          >
            {verificationError}
          </p>
          {verificationError.startsWith("We could not check") ? (
            <button
              className="mt-5 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              onClick={handleVerifyAgain}
              type="button"
            >
              Try again
            </button>
          ) : null}
          <p>
            <a
              className="mt-5 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              href={resetPath}
            >
              Request a new reset link
            </a>
          </p>
        </>
      ) : verification === "unconfirmed" ? (
        <div className="mt-3 space-y-5">
          <p
            role="alert"
            className="text-sm leading-6 text-zinc-600 dark:text-zinc-400"
          >
            {unconfirmedMessage}
          </p>
          <LogoutButton audience={audience} intent="sign-in-again" />
          <a
            className="inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            href={resetPath}
          >
            Request a new reset link
          </a>
        </div>
      ) : verification === "complete" ? (
        <>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Your password has been updated. You can now sign in with the new
            password.
          </p>
          <div className="mt-6">
            <LogoutButton audience={audience} intent="sign-in-again" />
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Set a new password for {email}.
          </p>
          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block space-y-2 text-sm font-medium">
              <span>New password</span>
              <input
                autoComplete="new-password"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                name="password"
                readOnly={isSubmitting}
                required
                type="password"
              />
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>Confirm new password</span>
              <input
                autoComplete="new-password"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                name="passwordConfirmation"
                readOnly={isSubmitting}
                required
                type="password"
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
              {isSubmitting ? "Updating…" : "Update password"}
            </button>
          </form>
          <p className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">
            Need a fresh link?{" "}
            <a
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              href={resetPath}
            >
              Request another reset email
            </a>
          </p>
        </>
      )}
    </div>
  );
};

export { ResetPasswordConfirmForm };
