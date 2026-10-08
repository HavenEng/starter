import type { NextRequest } from "next/server";
import { createSession } from "@/lib/auth/session-handlers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return createSession(request, "user");
}
