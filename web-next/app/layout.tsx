import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoachXYZ | AI Sports Form Analysis",
  description: "Upload training footage and get timestamped coaching feedback in under a minute.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
