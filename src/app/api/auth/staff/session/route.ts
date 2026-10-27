import { createSession } from "@/lib/auth/session-handlers";
import { apiRoute } from "@/lib/api/handler";
export const runtime = "nodejs";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/auth/staff/session", audience: "staff" },
  {
    POST: (request) => createSession(request, "staff"),
  },
);
