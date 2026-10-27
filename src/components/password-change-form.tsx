"use client";
import { useState, type FormEvent } from "react";
import type { AuthAudience } from "@/lib/auth/audience";
import { getAuthPath } from "@/lib/auth/audience";
import { LogoutButton } from "@/app/account/logout-button";
import { PASSWORD_CHANGE_UNCONFIRMED } from "@/lib/auth/password-change-result";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  PASSWORD_LENGTH_MESSAGE,
} from "@/lib/auth/password-policy";
import {
  AuthResponseError,
  reportUnexpectedError,
} from "@/lib/observability/report";

const PasswordChangeForm = ({ audience }: { audience: AuthAudience }) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    setError(null);
    if (
      typeof body.currentPassword !== "string" ||
      !body.currentPassword.length ||
      body.currentPassword.length > MAX_PASSWORD_LENGTH ||
      typeof body.newPassword !== "string" ||
      body.newPassword.length < MIN_PASSWORD_LENGTH ||
      body.newPassword.length > MAX_PASSWORD_LENGTH
    ) {
      setError(PASSWORD_LENGTH_MESSAGE);
      return;
    }
    if (body.newPassword !== body.passwordConfirmation) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(
        `/api/auth/${audience === "staff" ? "staff/" : ""}change-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok === true) {
        form.reset();
        setComplete(true);
        return;
      }
      if (!response.ok) {
        reportUnexpectedError(
          new AuthResponseError(
            "Password change failed",
            response.status,
            response.headers.get("x-request-id") ?? undefined,
            response.headers.get("x-sentry-event-id") ?? undefined,
          ),
          { operation: "auth.change-password", audience },
        );
        if (response.status === 429) {
          setError("Too many requests");
          return;
        }
        if (response.status === 401) {
          form.reset();
          setRecoveryMessage("Please sign in again to continue.");
          return;
        }
        const knownRejection =
          typeof result?.error === "string" &&
          typeof result?.code === "string" &&
          result.code !== PASSWORD_CHANGE_UNCONFIRMED.code &&
          (response.status < 500 || result.code === "SERVICE_UNAVAILABLE");
        if (!knownRejection) {
          form.reset();
          setRecoveryMessage(PASSWORD_CHANGE_UNCONFIRMED.message);
          return;
        }
        setError(
          result.error ||
            "We could not change your password. Please try again.",
        );
        return;
      }
      reportUnexpectedError(new Error("Invalid password-change response"), {
        operation: "auth.change-password",
        audience,
      });
      form.reset();
      setRecoveryMessage(PASSWORD_CHANGE_UNCONFIRMED.message);
    } catch (failure) {
      reportUnexpectedError(failure, {
        operation: "auth.change-password",
        audience,
      });
      form.reset();
      setRecoveryMessage(PASSWORD_CHANGE_UNCONFIRMED.message);
    } finally {
      setPending(false);
    }
  }
  if (complete)
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <h1 className="text-3xl font-semibold">Password updated</h1>
        <p>Sign in again with your new password.</p>
        <LogoutButton audience={audience} intent="sign-in-again" />
      </main>
    );
  if (recoveryMessage)
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <h1 className="text-3xl font-semibold">Sign in again</h1>
        <p role="alert">{recoveryMessage}</p>
        <LogoutButton audience={audience} intent="sign-in-again" />
        <a
          className="text-blue-600 underline"
          href={getAuthPath(audience, "/reset-password")}
        >
          Forgot password?
        </a>
      </main>
    );
  return (
    <main className="mx-auto max-w-md space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Change password</h1>
      <form className="space-y-5" onSubmit={submit}>
        {(
          [
            ["currentPassword", "Current password"],
            ["newPassword", "New password"],
            ["passwordConfirmation", "Confirm new password"],
          ] as const
        ).map(([name, label]) => (
          <label className="block space-y-2" key={name}>
            <span>{label}</span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              name={name}
              type="password"
              autoComplete={
                name === "currentPassword" ? "current-password" : "new-password"
              }
              minLength={
                name === "currentPassword" ? undefined : MIN_PASSWORD_LENGTH
              }
              maxLength={MAX_PASSWORD_LENGTH}
              required
              readOnly={pending}
            />
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
          disabled={pending}
        >
          {pending ? "Updating…" : "Change password"}
        </button>
      </form>
    </main>
  );
};
export { PasswordChangeForm };
