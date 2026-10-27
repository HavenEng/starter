import {
  withRequestLogging,
  reportRequestFailure,
} from "@/lib/observability/request-logging";
import type { NextRequest } from "next/server";
import type { AuthAudience } from "@/lib/auth/audience";
import { enforceRateLimit } from "@/lib/rate-limit/store";
import { errors } from "./application-error";
import { getRequestId } from "@/lib/observability/request-logging";

type Metadata = { route: string; audience?: AuthAudience };
type Context = { params: Promise<Record<string, string | string[]>> };
type Handler<C> = (request: NextRequest, context: C) => Promise<Response>;
const methods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;
type Method = (typeof methods)[number];

export function withApiHandler<
  C = { params: Promise<Record<string, string | string[]>> },
>(
  handler: (request: NextRequest, context: C) => Promise<Response>,
  metadata: Metadata,
) {
  const wrapped = withRequestLogging(
    async (request: NextRequest, context: C) => {
      try {
        if (
          !(await enforceRateLimit(
            request.nextUrl.pathname,
            request.method,
            request.headers,
          ))
        )
          throw errors.limited();
      } catch (error) {
        const logout =
          request.method === "POST" &&
          /^\/api\/auth\/(staff\/)?logout\/?$/.test(request.nextUrl.pathname);
        if (
          !logout ||
          !(error instanceof Error) ||
          !("status" in error) ||
          error.status !== 503
        )
          throw error;
        reportRequestFailure(error, {
          operation: "rate-limit.consume",
          audience: metadata.audience,
        });
      }
      return handler(request, context);
    },
    metadata,
    true,
  );
  return (request: NextRequest, context: C) => wrapped(request, context);
}

// Export every method so framework-generated 405/OPTIONS responses cannot skip
// the limiter. CI requires every route to use this factory, including fallbacks.
export function apiRoute<C = Context>(
  metadata: Metadata,
  handlers: Partial<Record<Method, Handler<C>>>,
) {
  const allowed = [
    ...Object.keys(handlers),
    ...(handlers.GET && !handlers.HEAD ? ["HEAD"] : []),
    ...(handlers.OPTIONS ? [] : ["OPTIONS"]),
  ].join(", ");
  return Object.fromEntries(
    methods.map((method) => [
      method,
      withApiHandler<C>(async (request, context) => {
        const handle = handlers[method];
        if (handle) return handle(request, context);
        if (method === "HEAD" && handlers.GET) {
          const response = await handlers.GET(request, context);
          return new Response(null, {
            status: response.status,
            headers: response.headers,
          });
        }
        if (method === "OPTIONS")
          return new Response(null, {
            status: 204,
            headers: { Allow: allowed },
          });
        return Response.json(
          {
            error: "Method not allowed",
            code: "METHOD_NOT_ALLOWED",
            requestId: getRequestId(),
          },
          {
            status: 405,
            headers: { Allow: allowed, "Cache-Control": "no-store" },
          },
        );
      }, metadata),
    ]),
  ) as Record<Method, Handler<C>>;
}
