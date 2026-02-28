import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoachAI - AI Sports Video Analysis",
  description: "Upload your sports video and get AI-powered coaching analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
