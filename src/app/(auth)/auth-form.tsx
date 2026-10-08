"use client";

import {
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthAudience } from "@/lib/auth/audience";
import { getAuthPath, getSessionApiPath } from "@/lib/auth/audience";
import { getFirebaseAuth } from "@/lib/firebase/client";

type AuthFormProps = {
  mode: "login" | "signup";
  audience?: AuthAudience;
};

function getAuthErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "The email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account already exists for this email.";
    case "auth/weak-password":
      return "Choose a stronger password.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Authentication.";
    case "auth/operation-not-allowed":
      return "Enable this sign-in method in the Firebase console first.";
    default:
      return error instanceof Error
        ? error.message
        : "We could not complete sign-in. Please try again.";
  }
}

async function establishServerSession(idToken: string, audience: AuthAudience) {
  const response = await fetch(getSessionApiPath(audience, "session"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : "We could not start your session. Please try again.";
    throw new Error(message);
  }
}

const AuthForm = ({ mode, audience = "user" }: AuthFormProps) => {
  const isSignup = mode === "signup";
  const isStaff = audience === "staff";
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const isCreatingAccount = isSignup && createdEmail === null;

  const finishSignIn = async (idToken: string) => {
    await establishServerSession(idToken, audience);
    await signOut(getFirebaseAuth(audience));
    router.replace(isStaff ? "/private" : "/account");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setIsSubmitting(true);

    try {
      const auth = getFirebaseAuth(audience);
      await setPersistence(auth, inMemoryPersistence);

      const email = createdEmail ?? String(formData.get("email") ?? "").trim();
      const password = String(formData.get("password") ?? "");
      const credential = isCreatingAccount
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password);

      if (isCreatingAccount) {
        setCreatedEmail(email);
      }

      await finishSignIn(await credential.user.getIdToken());
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
        {isStaff ? "Staff portal" : "Firebase Authentication"}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        {createdEmail
          ? "Finish signing in"
          : isSignup
            ? "Create your account"
            : isStaff
              ? "Staff sign in"
              : "Welcome back"}
      </h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {createdEmail
          ? "Your account was created. Retry sign-in to finish."
          : isSignup
            ? "Create an account with your email and password."
            : "Sign in with your email and password."}
      </p>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2 text-sm font-medium">
          <span>Email</span>
          <input
            autoComplete="email"
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700"
            name="email"
            readOnly={isSubmitting || createdEmail !== null}
            required
            type="email"
          />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          <span>Password</span>
          <input
            autoComplete={
              isCreatingAccount ? "new-password" : "current-password"
            }
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700"
            minLength={isCreatingAccount ? 8 : undefined}
            name="password"
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
          {isSubmitting
            ? "Please wait…"
            : createdEmail
              ? "Retry sign-in"
              : isSignup
                ? "Create account"
                : "Sign in"}
        </button>
      </form>

      {!isCreatingAccount ? (
        <p className="mt-4 text-right text-sm">
          <a
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            href={getAuthPath(audience, "/reset-password")}
          >
            Forgot password?
          </a>
        </p>
      ) : null}

      {isStaff ? (
        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Staff access is managed by an administrator.
        </p>
      ) : (
        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          {isSignup ? "Already have an account?" : "New here?"}{" "}
          <a
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            href={isSignup ? "/login" : "/signup"}
          >
            {isSignup ? "Sign in" : "Create an account"}
          </a>
        </p>
      )}
    </div>
  );
};

export { AuthForm };
