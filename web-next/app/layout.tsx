import type { Metadata } from "next";
import { SentryProvider } from "./sentry-provider";
import AuthHeader from "@/components/AuthHeader";
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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen antialiased pt-14">
        <AuthHeader />
        <a
          href="#analyze"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[10000] focus:p-4 focus:bg-teal-600 focus:text-white focus:outline-none"
        >
          Skip to upload
        </a>
        <SentryProvider>{children}</SentryProvider>
      </body>
    </html>
  );
}
