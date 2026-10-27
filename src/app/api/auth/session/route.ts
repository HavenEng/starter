import { createSession } from "@/lib/auth/session-handlers";
import { apiRoute } from "@/lib/api/handler";
export const runtime = "nodejs";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/auth/session", audience: "user" },
  {
    POST: (request) => createSession(request, "user"),
  },
);
