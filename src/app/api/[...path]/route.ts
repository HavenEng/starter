import { apiRoute } from "@/lib/api/handler";
import { errors } from "@/lib/api/application-error";
const missing = async (): Promise<Response> => {
  throw errors.missing();
};
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/*" },
  {
    GET: missing,
    HEAD: missing,
    POST: missing,
    PUT: missing,
    PATCH: missing,
    DELETE: missing,
    OPTIONS: missing,
  },
);
