import { clearSession } from "@/lib/auth/session-handlers";
import { withRequestLogging } from "@/lib/observability/request-logging";

export const POST = withRequestLogging(
  (request) => clearSession(request, "staff"),
  { route: "/api/auth/staff/logout", audience: "staff" },
);
