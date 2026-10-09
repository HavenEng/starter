import { NextResponse } from "next/server";
import { isObservabilityTestEnabled } from "@/lib/observability/config";
import {
  withRequestLogging,
  getRequestId,
} from "@/lib/observability/request-logging";
import { reportUnexpectedError } from "@/lib/observability/report";
import { logger } from "@/lib/observability/logger";

export const runtime = "nodejs";

export const GET = withRequestLogging(
  async (request) => {
    if (!isObservabilityTestEnabled())
      return new NextResponse(null, { status: 404 });
    const mode = request.nextUrl.searchParams.get("mode");
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
  { route: "/api/observability-test" },
);
