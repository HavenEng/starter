import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const RootLayout = ({ children }: { children: ReactNode }) => {
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
