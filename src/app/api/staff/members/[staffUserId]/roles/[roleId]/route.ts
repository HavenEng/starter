import { apiRoute } from "@/lib/api/handler";
import { requireSameOrigin, requireUuid } from "@/lib/api/request";
import { requireApiStaffScope } from "@/lib/auth/api-guards";
import { setStaffRole } from "@/lib/auth/staff-administration";
export const runtime = "nodejs";
type Context = { params: Promise<{ staffUserId: string; roleId: string }> };
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  {
    route: "/api/staff/members/[staffUserId]/roles/[roleId]",
    audience: "staff",
  },
  {
    PUT: async (request, context: Context) => {
      requireSameOrigin(request);
      const actor = await requireApiStaffScope("staff:roles:write");
      const { staffUserId, roleId } = await context.params;
      await setStaffRole(
        actor.id,
        requireUuid(staffUserId),
        requireUuid(roleId),
        true,
      );
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
    DELETE: async (request, context: Context) => {
      requireSameOrigin(request);
      const actor = await requireApiStaffScope("staff:roles:write");
      const { staffUserId, roleId } = await context.params;
      await setStaffRole(
        actor.id,
        requireUuid(staffUserId),
        requireUuid(roleId),
        false,
      );
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
  },
);
