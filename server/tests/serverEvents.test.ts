import { describe, expect, test } from 'bun:test'
import type { Redis as IORedis } from 'ioredis'

import {
  createServerEventBus,
  NOTIFICATION_EVENT_CHANNEL,
  REPORT_EVENT_CHANNEL,
  type ReportEventPayload,
} from '../src/lib/serverEvents'

type Listener = (...args: unknown[]) => void

class FakeRedisHub {
  readonly clients = new Set<FakeRedisClient>()
  readonly published: Array<{ channel: string; message: string }> = []

  createClient(): FakeRedisClient {
    const client = new FakeRedisClient(this)
    this.clients.add(client)
    return client
  }

  broadcast(channel: string, message: string): void {
    for (const client of this.clients) {
      if (client.subscribed.has(channel)) client.receive(channel, message)
    }
  }
}

class FakeRedisClient {
  readonly subscribed = new Set<string>()
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(private readonly hub: FakeRedisHub) {}

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  async subscribe(...channels: string[]): Promise<number> {
    for (const channel of channels) this.subscribed.add(channel)
    return channels.length
  }

  async publish(channel: string, message: string): Promise<number> {
    this.hub.published.push({ channel, message })
    this.hub.broadcast(channel, message)
    return 1
  }

  receive(channel: string, message: string): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener(channel, message)
    }
  }

  emitClose(): void {
    for (const listener of this.listeners.get('close') ?? []) listener()
  }

  async quit(): Promise<void> {
    this.hub.clients.delete(this)
  }

  disconnect(): void {
    this.hub.clients.delete(this)
  }
}

const report = (overrides: Partial<ReportEventPayload> = {}): ReportEventPayload => ({
  report_job_id: 'report-1',
  auth0_id: 'auth0|coach',
  status: 'running',
  report_id: null,
  error: null,
  progress: 45,
  created_at: 1,
  updated_at: 2,
  ...overrides,
})

const makeBus = (hub: FakeRedisHub, origin: string) =>
  createServerEventBus({
    getUrl: () => 'redis://fake',
    localRedis: () => true,
    origin,
    createClient: () => hub.createClient() as unknown as IORedis,
  })

describe('shared server event bus', () => {
  test('delivers report and notification events across two replicas exactly once', async () => {
    const hub = new FakeRedisHub()
    const busA = makeBus(hub, 'replica-a')
    const busB = makeBus(hub, 'replica-b')
    const receivedByB: unknown[] = []
    const receivedByA: unknown[] = []

    try {
      expect(await busA.start()).toBe(true)
      expect(await busB.start()).toBe(true)
      const stopReport = busB.subscribe(REPORT_EVENT_CHANNEL, (payload) =>
        receivedByB.push(payload),
      )
      const stopNotification = busA.subscribe(NOTIFICATION_EVENT_CHANNEL, (payload) =>
        receivedByA.push(payload),
      )

      expect(await busA.publish('report-job', REPORT_EVENT_CHANNEL, report())).toBe(true)
      expect(
        await busB.publish('notification', NOTIFICATION_EVENT_CHANNEL, {
          id: 'notification-1',
          auth0_id: 'auth0|coach',
          type: 'report_ready',
          title: 'Ready',
          body: null,
          data: {},
          read: false,
          created_at: new Date(0).toISOString(),
        }),
      ).toBe(true)

      expect(receivedByB).toEqual([report()])
      expect(receivedByA).toHaveLength(1)
      expect((receivedByA[0] as { auth0_id: string }).auth0_id).toBe('auth0|coach')
      stopReport()
      stopNotification()
    } finally {
      await busA.stop()
      await busB.stop()
    }
  })

  test('publishes to Redis even when the producer has no local subscriber', async () => {
    const hub = new FakeRedisHub()
    const bus = makeBus(hub, 'producer')
    try {
      expect(await bus.publish('report-job', REPORT_EVENT_CHANNEL, report())).toBe(true)
      expect(hub.published).toHaveLength(1)
      expect(hub.published[0]?.channel).toBe(REPORT_EVENT_CHANNEL)
    } finally {
      await bus.stop()
    }
  })

  test('disconnects a publisher when its transport closes', async () => {
    const hub = new FakeRedisHub()
    const bus = makeBus(hub, 'producer')
    try {
      expect(await bus.publish('report-job', REPORT_EVENT_CHANNEL, report())).toBe(true)
      const publisher = [...hub.clients].find((client) => client.subscribed.size === 0)
      expect(publisher).toBeDefined()
      publisher!.emitClose()
      expect(hub.clients.has(publisher!)).toBe(false)
    } finally {
      await bus.stop()
    }
  })

  test('keeps local delivery available without Redis', async () => {
    const bus = createServerEventBus({ getUrl: () => null, origin: 'local' })
    const received: unknown[] = []
    const stop = bus.subscribe(REPORT_EVENT_CHANNEL, (payload) => received.push(payload))
    try {
      expect(await bus.start()).toBe(true)
      expect(await bus.publish('report-job', REPORT_EVENT_CHANNEL, report())).toBe(false)
      expect(received).toEqual([report()])
    } finally {
      stop()
      await bus.stop()
    }
  })

  test('notifies streams when the shared subscriber disconnects', async () => {
    const hub = new FakeRedisHub()
    const bus = makeBus(hub, 'replica-a')
    let disconnected = 0
    const stopDisconnect = bus.onDisconnect(() => {
      disconnected += 1
    })
    try {
      expect(await bus.start()).toBe(true)
      const subscriber = [...hub.clients].find((client) => client.subscribed.size > 0)
      expect(subscriber).toBeDefined()
      subscriber!.emitClose()
      expect(disconnected).toBe(1)
      expect(hub.clients.has(subscriber!)).toBe(false)
    } finally {
      stopDisconnect()
      await bus.stop()
    }
  })
})
