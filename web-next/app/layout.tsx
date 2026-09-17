import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { SentryProvider } from "./sentry-provider";
import AuthHeader from "@/components/AuthHeader";
import { Toaster } from "@/components/9ui/ui/sonner";
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
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen antialiased bg-[var(--background)] text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthHeader />
          <a
            href="#analyze"
            className="sr-only focus:not-sr-only focus:absolute focus:z-[10000] focus:p-4 focus:bg-primary focus:text-primary-foreground focus:outline-none"
          >
            Skip to upload
          </a>
          <div className="root">{children}</div>
        </ThemeProvider>
        <SentryProvider>
          <Toaster position="bottom-right" richColors />
        </SentryProvider>
      </body>
    </html>
  );
}