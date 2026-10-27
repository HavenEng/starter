import "server-only";

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import type { AuthAudience } from "@/lib/auth/audience";
import { logger } from "./logger";
import { setErrorRequestId } from "./error-request-id";
import { unstable_rethrow } from "next/navigation";
import { ApplicationError } from "@/lib/api/application-error";
import {
  AuthResponseError,
  getErrorCode,
  isSentryEventId,
  reportUnexpectedError,
  SENTRY_EVENT_ID_HEADER,
} from "./report";

const requests = new AsyncLocalStorage<{ requestId: string }>();
export function getRequestId() {
  return requests.getStore()?.requestId;
}
export { getErrorRequestId } from "./error-request-id";

// Recovered failures need their own operational record while the enclosing
// request still emits exactly one completion record with its actual HTTP status.
export function reportRequestFailure(
  error: unknown,
  context: { operation: string; audience?: AuthAudience },
) {
  const requestId = getRequestId();
  try {
    logger.error(
      { ...context, requestId, errorCode: getErrorCode(error) },
      "Request dependency failed",
    );
  } catch {
    /* A broken log sink must not change the recovered response. */
  }
  reportUnexpectedError(error, { ...context, requestId });
}

export function withRequestLogging<C = undefined>(
  handler: (request: NextRequest, context: C) => Promise<Response>,
  metadata: { route: string; audience?: AuthAudience },
  handleErrors = false,
) {
  return async (request: NextRequest, context?: C) => {
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
        let failure: unknown;
        let errorCode: string | undefined;
        try {
          let response: Response;
          try {
            response = await handler(request, context as C);
          } catch (error) {
            if (!handleErrors) throw error;
            unstable_rethrow(error);
            failure = error;
            const known = error instanceof ApplicationError ? error : undefined;
            const errorStatus = known?.status ?? 500;
            errorCode = known?.code ?? "INTERNAL_ERROR";
            response = Response.json(
              errorStatus === 429
                ? { error: "Too many requests" }
                : {
                    error:
                      errorStatus >= 500
                        ? "Service unavailable. Please try again."
                        : known!.publicMessage,
                    code: errorCode,
                    requestId,
                  },
              { status: errorStatus, headers: { "Cache-Control": "no-store" } },
            );
          }
          status = response.status;
          if (status === 429) {
            response = Response.json(
              { error: "Too many requests" },
              { status: 429, headers: { "Cache-Control": "no-store" } },
            );
          } else response.headers.set("x-request-id", requestId);
          if (status >= 500 && Sentry.isEnabled()) {
            const eventId = reportUnexpectedError(
              failure ??
                new AuthResponseError(
                  "Server request returned an unexpected failure",
                  status,
                  requestId,
                ),
              {
                operation: failure ? "http.exception" : "http.response",
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
              {
                status,
                durationMs: Math.round(performance.now() - started),
                ...(errorCode ? { errorCode } : {}),
              },
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
