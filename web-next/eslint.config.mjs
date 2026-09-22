import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Vendored Base UI + shadcn chart (components/9ui/ui/chart.tsx). The recharts
  // payload types are opaque by design, and the chart memo deps can't satisfy
  // react-hooks' preserve-manual-memoization. Third-party code — exempt.
  {
    files: ['components/9ui/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  globalIgnores(['.next/**', 'node_modules/**', 'out/**', 'build/**', 'next-env.d.ts']),
])
