import "server-only";

import { redirect } from "next/navigation";
import { getCurrentStaffUser } from "@/lib/auth/session";

export async function requireStaffUser() {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/staff/login");
  }

  return user;
}
