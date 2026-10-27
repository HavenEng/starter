import { apiRoute } from "@/lib/api/handler";
import { requireSameOrigin, requireUuid } from "@/lib/api/request";
import { requireApiStaffScope } from "@/lib/auth/api-guards";
import { disableAccount } from "@/lib/auth/staff-administration";
export const runtime = "nodejs";
export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/staff/members/[staffUserId]/disable", audience: "staff" },
  {
    POST: async (
      request,
      context: { params: Promise<{ staffUserId: string }> },
    ) => {
      requireSameOrigin(request);
      const actor = await requireApiStaffScope("staff:disable");
      const { staffUserId } = await context.params;
      await disableAccount(actor.id, requireUuid(staffUserId), "staff");
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    },
  },
);
