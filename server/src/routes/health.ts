import { Elysia, t } from "elysia";

export const healthRoute = new Elysia({ prefix: "/health" })
  .get("/", () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }));
