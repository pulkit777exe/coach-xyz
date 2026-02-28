import { Elysia } from "elysia";

export const logger = () => {
  return new Elysia()
    .onRequest(({ request }) => {
      const timestamp = new Date().toISOString();
      console.log(
        `[${timestamp}] ${request.method} ${new URL(request.url).pathname}`
      );
    });
};
