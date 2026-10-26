import type { Redis } from 'ioredis'

import { getRawRedisClient } from './redis'

export const buildQueueConnection = (_source: string, client?: Redis | null): Redis | null => {
  const redisClient = client ?? getRawRedisClient()
  if (!redisClient) return null
  return redisClient
}
