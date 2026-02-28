import { Elysia } from "elysia";

export const authMiddleware = () => {
  return new Elysia()
    .derive(async ({ request, set }) => {
      // Simple API key authentication
      const apiKey = request.headers.get("x-api-key");
      const validApiKey = process.env.API_KEY;

      // Skip authentication for health check and public endpoints
      const path = new URL(request.url).pathname;
      if (
        path === "/health" ||
        path === "/" ||
        path === "/swagger" ||
        path.startsWith("/api/sports")
      ) {
        return { authenticated: true };
      }

      if (!validApiKey) {
        // If no API key is configured, allow all requests
        return { authenticated: true };
      }

      if (!apiKey || apiKey !== validApiKey) {
        set.status = 401;
        return {
          authenticated: false,
          error: "Unauthorized: Invalid API key"
        };
      }

      return { authenticated: true };
    });
};
