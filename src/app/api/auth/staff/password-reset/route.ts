import { apiRoute } from "@/lib/api/handler";
import { requestPasswordReset } from "@/lib/auth/password-handlers";
export const runtime = "nodejs";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/auth/staff/password-reset", audience: "staff" },
  {
    POST: (request) => requestPasswordReset(request, "staff"),
  },
);
