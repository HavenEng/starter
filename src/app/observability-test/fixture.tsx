"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { reportUnexpectedError } from "@/lib/observability/report";
import { LogoutButton } from "@/app/account/logout-button";

const ObservabilityFixture = () => {
  const [crashed, setCrashed] = useState(false);
  const [reported, setReported] = useState(false);
  if (crashed)
    throw new Error(
      "Observability browser fixture user@example.com password=secret-password",
    );
  return (
    <main>
      <h1>Observability test fixture</h1>
      <LogoutButton audience="staff" />
      <button onClick={() => setCrashed(true)}>Crash browser render</button>
      <button
        onClick={async () => {
          reportUnexpectedError(
            Object.assign(new Error("Expected credential rejection"), {
              code: "auth/invalid-credential",
            }),
            { operation: "auth.sign-in", audience: "user" },
          );
          reportUnexpectedError(
            { code: "auth/too-many-requests" },
            { operation: "auth.confirm-password-reset", audience: "user" },
          );
          await Sentry.flush(2_000);
          setReported(true);
        }}
      >
        Report expected error
      </button>
      <button
        onClick={async () => {
          Sentry.addBreadcrumb({
            category: "navigation",
            data: { to: "/reset-password/confirm?oobCode=reset-secret" },
          });
          Sentry.addBreadcrumb({
            category: "console",
            message: "secret-password",
          });
          Sentry.setContext("fixture", {
            email: "user@example.com",
            idToken: "token-secret",
            password: "secret-password",
          });
          reportUnexpectedError(
            Object.assign(
              new Error(
                'Observability handled fixture {"password":"json-password","idToken":"json-token"} password="two word quoted-secret" //user:url-password@example.com/reset?oobCode=url-code',
              ),
              {
                customData: {
                  email: "user@example.com",
                  token: "token-secret",
                },
              },
            ),
            { operation: "auth.sign-in", audience: "staff" },
          );
          await Sentry.flush(2_000);
          setReported(true);
        }}
      >
        Report unexpected error
      </button>
      {reported ? <p>Reporting finished</p> : null}
    </main>
  );
};

export { ObservabilityFixture };
