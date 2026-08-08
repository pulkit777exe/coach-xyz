import { Elysia } from "elysia";

import { buildError } from "../lib/errors";
import { ENGINE_URL, withTimeout } from "../lib/engine";

export default new Elysia()
  .post("/api/search", async ({ body, set }) => {
    const { query, max_angles, max_gap_searches } = body as {
      query?: string;
      max_angles?: number;
      max_gap_searches?: number;
    };

    if (!query?.trim()) {
      set.status = 400;
      return buildError("INVALID_REQUEST", "query is required.", false);
    }

    try {
      const res = await withTimeout(`${ENGINE_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          max_angles: max_angles ?? 6,
          max_gap_searches: max_gap_searches ?? 4,
        }),
      }, 180_000);

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const code = (errBody.code as string) ?? "SEARCH_FAILED";
        const msg = (errBody.message as string) ?? "Search service error.";
        set.status = res.status >= 400 && res.status < 500 ? res.status : 502;
        return buildError(code, msg, res.status >= 500);
      }

      const data = await res.json();
      set.status = 200;
      return data;
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      const isConnectivity = error instanceof TypeError || isTimeout;

      if (isConnectivity) {
        set.status = 502;
        return buildError(
          "ENGINE_UNAVAILABLE",
          "Search engine is temporarily unavailable. Please try again.",
          true,
        );
      }

      console.error(JSON.stringify({
        type: "search_proxy_error",
        message: error instanceof Error ? error.message : "unknown",
        timestamp: new Date().toISOString(),
      }));
      set.status = 500;
      return buildError("INTERNAL_ERROR", "Search service error.", true);
    }
  })

  .post("/api/search/stream", async ({ body, set }) => {
    const { query, max_angles, max_gap_searches } = body as {
      query?: string;
      max_angles?: number;
      max_gap_searches?: number;
    };

    if (!query?.trim()) {
      set.status = 400;
      return buildError("INVALID_REQUEST", "query is required.", false);
    }

    try {
      const engineRes = await withTimeout(`${ENGINE_URL}/search/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          max_angles: max_angles ?? 6,
          max_gap_searches: max_gap_searches ?? 4,
        }),
      }, 180_000);

      if (!engineRes.ok) {
        const errBody = (await engineRes.json().catch(() => ({}))) as Record<string, unknown>;
        const code = (errBody.code as string) ?? "SEARCH_FAILED";
        const msg = (errBody.message as string) ?? "Search service error.";
        set.status = engineRes.status >= 400 && engineRes.status < 500 ? engineRes.status : 502;
        return buildError(code, msg, engineRes.status >= 500);
      }

      return new Response(engineRes.body as ReadableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      const isConnectivity = error instanceof TypeError || isTimeout;

      if (isConnectivity) {
        set.status = 502;
        return buildError(
          "ENGINE_UNAVAILABLE",
          "Search engine is temporarily unavailable. Please try again.",
          true,
        );
      }

      console.error(JSON.stringify({
        type: "search_stream_proxy_error",
        message: error instanceof Error ? error.message : "unknown",
        timestamp: new Date().toISOString(),
      }));
      set.status = 500;
      return buildError("INTERNAL_ERROR", "Search service error.", true);
    }
  });
