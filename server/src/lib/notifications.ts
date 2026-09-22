import { EventEmitter } from "events";

import type { Queue as BullQueue } from "bullmq";
import {
  withHistoryStore,
  ensureInitialized,
  getAnalysisByServerJobId,
} from "./supabaseHistory";

// ── In-process pub/sub ───────────────────────────────────────────────────────
// Lightweight fan-out so SSE endpoints get notified when a new notification is
// created.  In production a Redis PUBLISH could replace this, but an in-memory
// EventEmitter is sufficient for single-instance dev and keeps the codebase
// dependency-free.

export type NotificationRow = {
  id: string;
  auth0_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read: boolean;
  created_at: string;
};

type NotificationEvent = {
  auth0Id: string;
  notification: NotificationRow;
};

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function onNotification(
  auth0Id: string,
  handler: (n: NotificationRow) => void,
): () => void {
  const listener = (evt: NotificationEvent) => {
    if (evt.auth0Id === auth0Id) handler(evt.notification);
  };
  bus.on("notification", listener);
  return () => bus.off("notification", listener);
}

function publish(auth0Id: string, notification: NotificationRow) {
  bus.emit("notification", {
    auth0Id,
    notification,
  } satisfies NotificationEvent);
}

// ── Table bootstrap ──────────────────────────────────────────────────────────

let notificationsInitPromise: Promise<void> | null = null;

export async function ensureNotificationsInitialized(): Promise<void> {
  if (notificationsInitPromise) return notificationsInitPromise;
  notificationsInitPromise = (async () => {
    await ensureInitialized();
    await withHistoryStore(async (db) => {
      await db`
        create table if not exists notifications (
          id uuid primary key default gen_random_uuid(),
          auth0_id text not null,
          type text not null,
          title text not null,
          body text,
          data jsonb not null default '{}'::jsonb,
          read boolean not null default false,
          created_at timestamptz not null default now()
        );
      `;
      await db`
        create index if not exists idx_notifications_auth0_created
        on notifications (auth0_id, created_at desc);
      `;
    });
  })();
  return notificationsInitPromise;
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────

export type CreateNotificationInput = {
  auth0Id: string;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
};

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  const result = await withHistoryStore(async (db) => {
    await ensureNotificationsInitialized();
    const rows = await db<NotificationRow[]>`
      insert into notifications (auth0_id, type, title, body, data)
      values (
        ${input.auth0Id},
        ${input.type},
        ${input.title},
        ${input.body ?? null},
        ${JSON.stringify(input.data ?? {})}::jsonb
      )
      returning *;
    `;
    return rows?.[0] ?? null;
  });

  if (result) publish(input.auth0Id, result);
  return result;
}

export async function listNotifications(
  auth0Id: string,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  const { limit = 20, unreadOnly = false } = opts;
  const unreadFilter = unreadOnly ? "and read = false" : "";
  return (
    (await withHistoryStore(async (db) => {
      await ensureNotificationsInitialized();
      return db<NotificationRow[]>`
      select * from notifications
      where auth0_id = ${auth0Id}
        ${db.unsafe(unreadFilter)}
      order by created_at desc
      limit ${limit};
    `;
    })) ?? []
  );
}

export async function markNotificationRead(
  auth0Id: string,
  id: string,
): Promise<NotificationRow | null> {
  return withHistoryStore(async (db) => {
    await ensureNotificationsInitialized();
    const rows = await db<NotificationRow[]>`
      update notifications set read = true
      where id = ${id} and auth0_id = ${auth0Id}
      returning *;
    `;
    return rows?.[0] ?? null;
  });
}

export async function markAllRead(auth0Id: string): Promise<void> {
  await withHistoryStore(async (db) => {
    await ensureNotificationsInitialized();
    await db`
      update notifications set read = true
      where auth0_id = ${auth0Id} and read = false;
    `;
  });
}

export async function unreadCount(auth0Id: string): Promise<number> {
  const result = await withHistoryStore(async (db) => {
    await ensureNotificationsInitialized();
    const rows = await db<{ count: number }[]>`
      select count(*)::int as count from notifications
      where auth0_id = ${auth0Id} and read = false;
    `;
    return rows?.[0]?.count ?? 0;
  });
  return result ?? 0;
}

// ── BullMQ queue event hooks ─────────────────────────────────────────────────
// Listens for completed/failed analysis jobs and creates notifications for the
// owning coach.  Replicates the Redis connection setup from queue.ts without
// importing or modifying it.

function getQueueEventsConnection() {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !token) return null;

  const urlObj = new URL(restUrl);
  const host = urlObj.host;
  const redisUrl = `rediss://default:${token}@${host}:6379`;

  try {
    const IORedis = require("ioredis") as typeof import("ioredis").default;
    const client = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      tls: {},
      enableReadyCheck: false,
      lazyConnect: true,
      commandTimeout: 30000,
      connectTimeout: 30000,
      retryStrategy(times: number) {
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
    });
    client.on("error", (err: Error) => {
      console.error(
        JSON.stringify({
          type: "redis_error",
          source: "notifications-events",
          message: err.message,
        }),
      );
    });
    return client;
  } catch {
    return null;
  }
}

/**
 * Resolves the owner (+ label) of an analysis. `getAnalysisByServerJobId` is the
 * primary source; falls back to a direct `analysis_history` query when its
 * auth0_id is absent (the dashboard SELECT does not always project it).
 */
type AnalysisOwner = { auth0Id: string; displayName: string | null };

async function resolveAnalysisOwner(
  serverJobId: string,
): Promise<AnalysisOwner | null> {
  const analysis = await getAnalysisByServerJobId(serverJobId);
  if (analysis?.auth0_id) {
    return { auth0Id: analysis.auth0_id, displayName: analysis.display_name };
  }

  const owner = await withHistoryStore(async (db) => {
    await ensureInitialized();
    const rows = await db<
      { auth0_id: string | null; display_name: string | null }[]
    >`
      select auth0_id, display_name from analysis_history
      where server_job_id = ${serverJobId}
      limit 1;
    `;
    const row = rows?.[0];
    return row?.auth0_id
      ? { auth0Id: row.auth0_id, displayName: row.display_name }
      : null;
  });
  return owner ?? null;
}

type AnalysisQueueJobData = {
  server_job_id: string;
  engine_job_id: string;
  session_token: string | null;
  player_index: number | null;
  video_key: string | null;
};

const queueEventsConnection = getQueueEventsConnection();
let analysisQueue: BullQueue<AnalysisQueueJobData> | null = null;

function attachQueueEventListeners() {
  if (!queueEventsConnection) return;

  try {
    const { QueueEvents: QueueEventsClass, Queue } = require("bullmq");
    const qe = new QueueEventsClass("coachai-analysis", {
      connection: queueEventsConnection,
    });
    analysisQueue = new Queue("coachai-analysis", {
      connection: queueEventsConnection,
    }) as BullQueue<AnalysisQueueJobData>;

    qe.on("completed", async ({ jobId }: { jobId: string }) => {
      try {
        const job = await analysisQueue!.getJob(jobId);
        if (!job?.data?.server_job_id) return;

        const analysis = await resolveAnalysisOwner(job.data.server_job_id);
        if (!analysis) return;

        await createNotification({
          auth0Id: analysis.auth0Id,
          type: "analysis_complete",
          title: "Analysis complete",
          body: analysis.displayName || job.data.engine_job_id,
          data: {
            server_job_id: job.data.server_job_id,
            engine_job_id: job.data.engine_job_id,
          },
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            type: "notification_completed_handler_error",
            jobId,
            error: err instanceof Error ? err.message : "unknown",
          }),
        );
      }
    });

    qe.on(
      "failed",
      async ({
        jobId,
        failedReason,
      }: {
        jobId: string;
        failedReason?: string;
      }) => {
        try {
          const job = await analysisQueue!.getJob(jobId);
          if (!job?.data?.server_job_id) return;

          const isUnrecoverable = failedReason?.includes("UnrecoverableError");
          const retriesExhausted =
            (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 3);
          if (!retriesExhausted && !isUnrecoverable) return;

          const analysis = await resolveAnalysisOwner(job.data.server_job_id);
          if (!analysis) return;

          await createNotification({
            auth0Id: analysis.auth0Id,
            type: "analysis_failed",
            title: "Analysis failed",
            body: analysis.displayName || job.data.engine_job_id,
            data: {
              server_job_id: job.data.server_job_id,
              engine_job_id: job.data.engine_job_id,
            },
          });
        } catch (err) {
          console.error(
            JSON.stringify({
              type: "notification_failed_handler_error",
              jobId,
              error: err instanceof Error ? err.message : "unknown",
            }),
          );
        }
      },
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: "notification_queue_events_init_error",
        error: err instanceof Error ? err.message : "unknown",
      }),
    );
  }
}

// Attach lazily — if Redis is available
attachQueueEventListeners();
