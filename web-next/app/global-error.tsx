"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0d0d0d",
            color: "#f0ebe1",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: "28rem", padding: "1rem" }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
              Something went wrong
            </h1>
            <p style={{ color: "rgba(240, 235, 225, 0.4)", marginBottom: "0.5rem" }}>
              {error.message || "An unexpected error occurred."}
            </p>
            {error.digest && (
              <p style={{ color: "#71717a", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
                Error ID: {error.digest}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              <button
                onClick={reset}
                style={{
                  backgroundColor: "#f0ebe1",
                  color: "#0d0d0d",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "0.5rem",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                Try again
              </button>
              <button
                onClick={() => { window.location.href = "/"; }}
                style={{
                  backgroundColor: "transparent",
                  color: "#f0ebe1",
                  padding: "0.75rem 1.5rem",
                  borderRadius: "0.5rem",
                  fontWeight: 500,
                  border: "1px solid rgba(240, 235, 225, 0.1)",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
