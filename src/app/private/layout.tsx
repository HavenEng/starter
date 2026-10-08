import type { ReactNode } from "react";
import { requireStaffUser } from "@/lib/auth/require-staff-user";

const PrivateLayout = async ({ children }: { children: ReactNode }) => {
  await requireStaffUser();
  return children;
};

export default PrivateLayout;
