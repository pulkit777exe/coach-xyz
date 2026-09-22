import { describe, expect, test } from "bun:test";
import {
  buildError,
  isCoachAIError,
  isQueueRetryable,
  wrapEngineError,
} from "../src/lib/errors";
import type { CoachAIError } from "../src/lib/errors";

describe("isQueueRetryable", () => {
  test("retries retryable engine errors", () => {
    expect(isQueueRetryable({ retryable: true })).toBe(true);
  });

  test("does not retry errors the engine marks non-retryable", () => {
    expect(isQueueRetryable({ retryable: false })).toBe(false);
  });

  test("defaults to retryable when the flag is absent", () => {
    expect(isQueueRetryable({} as CoachAIError)).toBe(true);
  });
});

describe("engine retryability contract", () => {
  // The engine owns the retryable flag (engine/core/errors.py). These codes
  // must be non-retryable so the queue stops re-deriving policy. Pinned
  // against the engine's registry in test_errors.py.
  const UNRECOVERABLE = [
    "VIDEO_DECODE_FAILED",
    "VIDEO_EXPIRED",
    "VIDEO_NOT_FOUND",
    "JOB_NOT_FOUND",
    "INVALID_REQUEST",
    "MEDIAPIPE_UNAVAILABLE",
  ];

  test("unrecoverable codes are never queue-retryable", () => {
    for (const code of UNRECOVERABLE) {
      expect(isQueueRetryable({ retryable: false }), code).toBe(false);
    }
  });

  test("transient failures stay retryable end to end", () => {
    const err = wrapEngineError({
      code: "GEMINI_TIMEOUT",
      message: "took too long",
      retryable: true,
    });
    expect(isQueueRetryable(err)).toBe(true);
  });
});

describe("buildError", () => {
  test("uses the fallback message for a known code", () => {
    const err = buildError("RATE_LIMITED");
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toBe(
      "Too many requests. Please wait before trying again.",
    );
    expect(err.layer).toBe("server");
    expect(err.retryable).toBe(true);
  });

  test("falls back to a generic message for unknown codes", () => {
    expect(buildError("NOPE_NOT_A_CODE").message).toBe("Something went wrong.");
  });

  test("honors an override message and retryable flag", () => {
    const err = buildError("ENGINE_ERROR", "custom message", false);
    expect(err).toEqual({
      code: "ENGINE_ERROR",
      message: "custom message",
      layer: "server",
      retryable: false,
    });
  });

  test("defaults retryable to true", () => {
    expect(buildError("INTERNAL_ERROR").retryable).toBe(true);
  });
});

describe("wrapEngineError", () => {
  test("preserves engine code, message, and retryable", () => {
    const err = wrapEngineError({
      code: "NO_PLAYERS_DETECTED",
      message: "no players",
      retryable: false,
    });
    expect(err).toEqual({
      code: "NO_PLAYERS_DETECTED",
      message: "no players",
      layer: "engine",
      retryable: false,
    });
  });

  test("fills defaults for partial engine bodies", () => {
    const err = wrapEngineError({});
    expect(err).toEqual({
      code: "ENGINE_ERROR",
      message: "Analysis engine is temporarily unavailable.",
      layer: "engine",
      retryable: true,
    });
  });
});

describe("isCoachAIError", () => {
  const valid: CoachAIError = {
    code: "X",
    message: "m",
    layer: "engine",
    retryable: true,
  };

  test("accepts a well-formed CoachAIError", () => {
    expect(isCoachAIError(valid)).toBe(true);
    expect(isCoachAIError({ ...valid, layer: "server" })).toBe(true);
    expect(isCoachAIError({ ...valid, layer: "client" })).toBe(true);
  });

  test("rejects non-objects", () => {
    expect(isCoachAIError(null)).toBe(false);
    expect(isCoachAIError(undefined)).toBe(false);
    expect(isCoachAIError("nope")).toBe(false);
    expect(isCoachAIError(42)).toBe(false);
  });

  test("rejects the wrong shape", () => {
    expect(isCoachAIError({ code: "X", message: "m" })).toBe(false);
    expect(
      isCoachAIError({
        code: "X",
        message: "m",
        layer: "engine",
        retryable: "yes",
      }),
    ).toBe(false);
    expect(
      isCoachAIError({ code: "X", message: "m", layer: "db", retryable: true }),
    ).toBe(false);
    expect(
      isCoachAIError({
        code: 1,
        message: "m",
        layer: "engine",
        retryable: true,
      }),
    ).toBe(false);
  });
});
