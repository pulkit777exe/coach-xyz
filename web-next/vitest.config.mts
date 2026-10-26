import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit-test config for the web app. Tests cover pure helpers only — no
// browser, no network. The `@/*` alias mirrors the tsconfig `paths` entry so
// modules that import `@/types` resolve the same as under Next.js.
//
// The include globs were `lib/**/*.test.ts` alone, and that was not a neutral
// default — it made it *impossible* to put a test next to the code it covers,
// because everything under `components/` and `app/` was simply not matched. All
// 28 test files therefore lived in `lib/__tests__`, while `components/` (107
// files, ~21k lines) and `app/` (51 files, ~4.3k lines) had no test file at all.
// A test-location default silently became a coverage ceiling.
//
// Widening the globs costs nothing and needs no new dependency: `environment`
// stays `node`, so what can be written is unchanged in kind — `renderToStaticMarkup`
// for what the markup shows, and source-level assertions for what a render cannot
// observe. It just stops the config from forbidding the obvious location.
//
// `.tsx` is included because component tests import components. The environment is
// still `node`, so a test that needs a DOM still cannot have one — that is a real
// gap (3 of the 61 accessibility checks are source-level greps for exactly this
// reason) and it is recorded in docs/runbooks/coverage.md rather than papered
// over here.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}'],
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:3000',
    },
  },
})
