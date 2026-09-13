import { describe, expect, it } from "vitest"
import { parseEventStream } from "../sse"

// Response value is whatever streamScanProgress receives from fetch().
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream)
}

describe("parseEventStream", () => {
  it("parses newline-delimited data: JSON events", async () => {
    const events: unknown[] = []
    for await (const event of parseEventStream(
      sseResponse(['data: {"a":1}\n', 'data: {"a":2}\n', 'data: {"a":3}\n']),
    )) {
      events.push(event)
    }
    expect(events).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })

  it("buffers events split across chunks", async () => {
    const events: unknown[] = []
    for await (const event of parseEventStream(
      sseResponse(['data: {"', 'a":4}\ndata: {"a', '":5}\n']),
    )) {
      events.push(event)
    }
    expect(events).toEqual([{ a: 4 }, { a: 5 }])
  })

  it("skips non-data lines and malformed JSON", async () => {
    const events: unknown[] = []
    for await (const event of parseEventStream(
      sseResponse([': keepalive\n', 'data: {"ok":1}\n', 'data: {not json}\n', 'event: foo\ndata: {"ok":2}\n']),
    )) {
      events.push(event)
    }
    expect(events).toEqual([{ ok: 1 }, { ok: 2 }])
  })

  it("releases the reader even when the stream errors", async () => {
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    const res = new Response(stream)

    controller.enqueue(encoder.encode('data: {"ok":1}\n'))
    const it = parseEventStream(res)

    await expect(it.next()).resolves.toEqual({ done: false, value: { ok: 1 } })

    controller.error(new Error("boom"))
    await expect(it.next()).rejects.toThrow("boom")

    // The finally block released the lock on the errored stream.
    expect(res.body!.locked).toBe(false)
  })
})