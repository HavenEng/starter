import { NextResponse } from "next/server";
import { isObservabilityTestEnabled } from "@/lib/observability/config";
import { apiRoute } from "@/lib/api/handler";
import { getRequestId } from "@/lib/observability/request-logging";
import { reportUnexpectedError } from "@/lib/observability/report";
import { logger } from "@/lib/observability/logger";
import { ApplicationError, errors } from "@/lib/api/application-error";
import { FirebasePasswordError } from "@/lib/firebase/password-api";
import { PASSWORD_CHANGE_UNCONFIRMED } from "@/lib/auth/password-change-result";
export const runtime = "nodejs";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/observability-test" },
  {
    GET: async (request) => {
      if (!isObservabilityTestEnabled())
        return new NextResponse(null, { status: 404 });
      const mode = request.nextUrl.searchParams.get("mode");
      if (mode === "password-update-unconfirmed")
        throw new ApplicationError(
          PASSWORD_CHANGE_UNCONFIRMED.code,
          503,
          PASSWORD_CHANGE_UNCONFIRMED.message,
          {
            cause: new FirebasePasswordError(
              "staff",
              "update",
              "TRANSPORT_ERROR",
              undefined,
              {
                cause: new Error(
                  "Transport fixture password=unconfirmed-password-secret",
                ),
              },
            ),
          },
        );
      if (mode === "provider-error")
        throw errors.unavailable(
          new FirebasePasswordError(
            "staff",
            "update",
            "OPERATION_NOT_ALLOWED",
            400,
          ),
        );
      if (mode === "console") {
        const error = Object.assign(
          new Error('Console fixture password="console-quoted-secret"'),
          {
            credentials: { raw: "console-object-secret" },
            cause: new Error("Authorization: Bearer console-auth-secret"),
            email: "contact@example.com",
          },
        );
        console.error("Console fixture", error);
        console.log("%s=%s", "password", "console-password-secret");
        console.warn(
          "Console encoded fixture %s",
          JSON.stringify(
            JSON.stringify({
              password: "console-encoded-secret",
              refreshToken: "console-refresh-secret",
            }),
          ),
        );
        console.warn(
          'Provider response: {"credentials":{"raw":"console-fragment-secret"}}',
        );
        logger.warn('%s="%s"', "password", "pino-interpolated-secret");
        logger
          .child({
            requestId: getRequestId(),
            refreshToken: "child-fixture-secret",
          })
          .info("Fixture child");
        return NextResponse.json({ ok: true });
      }
      if (mode === "returned")
        return new NextResponse("Service unavailable", { status: 503 });
      if (mode === "admin-credential" || mode === "expired-token") {
        reportUnexpectedError(
          Object.assign(new Error("Observability Admin fixture"), {
            code:
              mode === "admin-credential"
                ? "auth/invalid-credential"
                : "auth/id-token-expired",
          }),
          {
            operation: "auth.verify-id-token",
            audience: "staff",
            requestId: getRequestId(),
          },
        );
        return NextResponse.json({ ok: true });
      }
      throw new Error(
        "Observability route fixture user@example.com postgres://user:db-password@localhost/db",
      );
    },
  },
);
