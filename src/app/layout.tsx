import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Web App Starter",
  description: "A modern TypeScript web app starter",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
