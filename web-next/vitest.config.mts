import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Unit-test config for the web app. Tests cover pure helpers only — no
// browser, no network. The `@/*` alias mirrors the tsconfig `paths` entry so
// modules that import `@/types` resolve the same as under Next.js.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    env: {
      NEXT_PUBLIC_API_URL: "http://localhost:3000",
    },
  },
})