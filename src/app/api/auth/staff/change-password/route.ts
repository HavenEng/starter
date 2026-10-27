import { apiRoute } from "@/lib/api/handler";
import { changePassword } from "@/lib/auth/password-handlers";
export const runtime = "nodejs";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/auth/staff/change-password", audience: "staff" },
  {
    POST: (request) => changePassword(request, "staff"),
  },
);
