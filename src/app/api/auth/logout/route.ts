import { clearSession } from "@/lib/auth/session-handlers";
import { apiRoute } from "@/lib/api/handler";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  {
    route: "/api/auth/logout",
    audience: "user",
  },
  {
    POST: (request) => clearSession(request, "user"),
  },
);
