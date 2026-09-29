import { describe, expect, test } from 'bun:test'

import { missingEnvVars, requiredEnvVars } from '../src/lib/env'

// Pure over an injected map: every boot shape without touching process.env.
describe('boot env validation', () => {
  test('dev needs only the engine URL', () => {
    expect(requiredEnvVars('development')).toEqual(['ENGINE_URL'])
    expect(requiredEnvVars(undefined)).toEqual(['ENGINE_URL'])
    expect(missingEnvVars({ ENGINE_URL: 'http://x:8001' }, 'development')).toEqual([])
  })

  test('production additionally needs Redis REST and the service token', () => {
    expect(requiredEnvVars('production')).toEqual([
      'ENGINE_URL',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'SERVICE_TOKEN',
    ])
  })

  test('missing and empty both count', () => {
    expect(
      missingEnvVars(
        {
          ENGINE_URL: 'http://x:8001',
          UPSTASH_REDIS_REST_URL: '',
          SERVICE_TOKEN: 's',
        },
        'production',
      ),
    ).toEqual(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'])
  })
})
