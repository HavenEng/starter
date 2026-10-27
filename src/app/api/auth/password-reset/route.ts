import { apiRoute } from "@/lib/api/handler";
import { requestPasswordReset } from "@/lib/auth/password-handlers";
export const runtime = "nodejs";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/auth/password-reset", audience: "user" },
  {
    POST: (request) => requestPasswordReset(request, "user"),
  },
);
