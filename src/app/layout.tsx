import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { isObservabilityTestEnabled } from "@/lib/observability/config";
import "./globals.css";

const RootLayout = async ({ children }: { children: ReactNode }) => {
  if (
    isObservabilityTestEnabled() &&
    (await cookies()).get("observability-root-error")?.value === "1"
  )
    throw new Error(
      'Observability root fixture password="root-password-secret"',
    );
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
};

export const metadata: Metadata = {
  title: "Web App Starter",
  description: "A modern TypeScript web app starter",
};

export default RootLayout;
