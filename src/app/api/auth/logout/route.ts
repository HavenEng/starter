import type { NextRequest } from "next/server";
import { clearSession } from "@/lib/auth/session-handlers";

export async function POST(request: NextRequest) {
  return clearSession(request, "user");
}
