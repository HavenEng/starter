import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installConsoleRedaction } =
      await import("./lib/observability/console");
    installConsoleRedaction();
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  try {
    const requestId =
      process.env.NEXT_RUNTIME === "nodejs"
        ? (
            await import("@/lib/observability/request-logging")
          ).getErrorRequestId(error)
        : undefined;
    Sentry.withScope((scope) => {
      if (requestId) scope.setTag("requestId", requestId);
      Sentry.captureRequestError(error, request, context);
    });
    // Await delivery, including when the hosting runtime has no waitUntil hook.
    await Sentry.flush(2_000);
  } catch {
    /* Reporting must not replace the original application failure. */
  }
};
