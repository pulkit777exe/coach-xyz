"use client";

import { useState } from "react";

export default function SentryExamplePage() {
  const [errorThrown, setErrorThrown] = useState(false);

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Sentry Example Page</h1>
      <p>If you can see this, Sentry is configured.</p>

      <button
        onClick={() => {
          setErrorThrown(true);
          throw new Error("Sentry test error from /sentry-example-page");
        }}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          backgroundColor: "#e53e3e",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          marginTop: "1rem",
        }}
      >
        Throw Test Error
      </button>

      {errorThrown && (
        <p style={{ color: "#e53e3e", marginTop: "1rem" }}>
          Error thrown — check your Sentry Issues dashboard.
        </p>
      )}
    </div>
  );
}
