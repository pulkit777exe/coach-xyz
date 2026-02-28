import { Elysia, t } from "elysia";

export const jobsRoute = new Elysia({ prefix: "/api/jobs" })
  .get("/:id", ({ params, set }) => {
    const job = (global as any).jobs?.get(params.id);
    if (!job) {
      set.status = 404;
      return { error: "Job not found" };
    }

    return job;
  })
  .delete("/:id", ({ params, set }) => {
    const job = (global as any).jobs?.get(params.id);
    if (!job) {
      set.status = 404;
      return { error: "Job not found" };
    }

    // Delete temp file
    if (job.file_path) {
      try {
        Bun.file(job.file_path).delete();
      } catch (error) {
        console.error("Error deleting file:", error);
      }
    }

    if (job.output_video_path) {
      try {
        Bun.file(job.output_video_path).delete();
      } catch (error) {
        console.error("Error deleting output video:", error);
      }
    }

    (global as any).jobs.delete(params.id);
    return { success: true };
  });
