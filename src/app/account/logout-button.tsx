"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AuthResponseError,
  reportUnexpectedError,
  SENTRY_EVENT_ID_HEADER,
} from "@/lib/observability/report";
import type { AuthAudience } from "@/lib/auth/audience";
import { getSessionApiPath } from "@/lib/auth/audience";

type LogoutButtonProps = {
  audience?: AuthAudience;
};

const LogoutButton = ({ audience = "user" }: LogoutButtonProps) => {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(getSessionApiPath(audience, "logout"), {
        method: "POST",
        credentials: "same-origin",
      });

      if (response.ok) {
        router.replace(audience === "staff" ? "/staff/login" : "/");
        return;
      }
      reportUnexpectedError(
        new AuthResponseError(
          "Logout request failed",
          response.status,
          response.headers.get("x-request-id") ?? undefined,
          response.headers.get(SENTRY_EVENT_ID_HEADER) ?? undefined,
        ),
        { operation: "auth.logout", audience },
      );
      setError("We could not sign you out. Please try again.");
    } catch (error) {
      reportUnexpectedError(error, { operation: "auth.logout", audience });
      setError("We could not sign you out. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
        disabled={isSubmitting}
        onClick={handleLogout}
        type="button"
      >
        {isSubmitting ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <p
          aria-live="polite"
          className="text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
};

export { LogoutButton };
