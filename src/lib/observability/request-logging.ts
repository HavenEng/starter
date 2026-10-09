import "server-only";

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import type { AuthAudience } from "@/lib/auth/audience";
import { logger } from "./logger";
import { setErrorRequestId } from "./error-request-id";
import {
  AuthResponseError,
  isSentryEventId,
  reportUnexpectedError,
  SENTRY_EVENT_ID_HEADER,
} from "./report";

const requests = new AsyncLocalStorage<{ requestId: string }>();
export function getRequestId() {
  return requests.getStore()?.requestId;
}
export { getErrorRequestId } from "./error-request-id";

export function withRequestLogging(
  handler: (request: NextRequest) => Promise<Response>,
  metadata: { route: string; audience?: AuthAudience },
) {
  return async (request: NextRequest) => {
    const requestId = randomUUID();
    const started = performance.now();
    const log = logger.child({
      requestId,
      method: request.method,
      ...metadata,
    });
    return requests.run({ requestId }, () =>
      Sentry.withIsolationScope(async (scope) => {
        scope.setTag("requestId", requestId);
        if (metadata.audience) scope.setTag("audience", metadata.audience);
        let status = 500;
        try {
          const response = await handler(request);
          status = response.status;
          response.headers.set("x-request-id", requestId);
          if (status >= 500 && Sentry.isEnabled()) {
            const eventId = reportUnexpectedError(
              new AuthResponseError(
                "Server request returned an unexpected failure",
                status,
                requestId,
              ),
              {
                operation: "http.response",
                audience: metadata.audience,
                requestId,
              },
            );
            if (isSentryEventId(eventId))
              response.headers.set(SENTRY_EVENT_ID_HEADER, eventId);
          }
          return response;
        } catch (error) {
          setErrorRequestId(error, requestId);
          throw error;
        } finally {
          const level =
            status >= 500 ? "error" : status >= 400 ? "warn" : "info";
          try {
            log[level](
              { status, durationMs: Math.round(performance.now() - started) },
              "Request completed",
            );
          } catch {
            /* A broken log sink must not break authentication. */
          }
        }
      }),
    );
  };
}
