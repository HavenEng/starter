import { clearSession } from "@/lib/auth/session-handlers";
import { apiRoute } from "@/lib/api/handler";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/auth/staff/logout", audience: "staff" },
  {
    POST: (request) => clearSession(request, "staff"),
  },
);
