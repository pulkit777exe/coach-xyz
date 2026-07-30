"use client";

// @sentry/nextjs automatically instruments error capturing via its SDK.
// This provider is a thin wrapper that can be extended if needed.
export function SentryProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
