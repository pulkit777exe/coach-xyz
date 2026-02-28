import { Elysia } from "elysia";

export const artifactsRoute = new Elysia({ prefix: "/api" })
  .get("/events/:id", ({ params, set }) => {
    const job = (global as any).jobs?.get(params.id);
    if (!job) {
      set.status = 404;
      return { error: "Job not found" };
    }

    if (!job.result) {
      set.status = 404;
      return { error: "Analysis result not available" };
    }

    return job.result;
  })
  .get("/download/:id", async ({ params, set }) => {
    const job = (global as any).jobs?.get(params.id);
    if (!job) {
      set.status = 404;
      return { error: "Job not found" };
    }

    const outputPath = job.output_video_path;
    if (!outputPath) {
      set.status = 404;
      return { error: "Rendered video not available" };
    }

    const file = Bun.file(outputPath);
    if (!(await file.exists())) {
      set.status = 404;
      return { error: "Rendered video file missing" };
    }

    set.headers["Content-Type"] = "video/mp4";
    set.headers["Content-Disposition"] = `attachment; filename=\"${params.id}_analyzed.mp4\"`;
    return file;
  });
