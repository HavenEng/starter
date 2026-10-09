import { createSession } from "@/lib/auth/session-handlers";
import { withRequestLogging } from "@/lib/observability/request-logging";

export const runtime = "nodejs";

export const POST = withRequestLogging(
  (request) => createSession(request, "user"),
  { route: "/api/auth/session", audience: "user" },
);
