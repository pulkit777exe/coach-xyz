import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoachXYZ | AI Sports Form Analysis",
  description:
    "Upload training footage and get timestamped form scores, correction cues, and annotated video — in under 60 seconds.",
  openGraph: {
    title: "CoachXYZ",
    description: "AI-powered sports video analysis for coaches.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
