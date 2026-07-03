"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export function SentryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      Sentry.captureException(event.error);
    };
    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
  }, []);

  return <>{children}</>;
}
