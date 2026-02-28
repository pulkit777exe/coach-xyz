import { Elysia } from "elysia";

export const errorHandler = () => {
  return new Elysia()
    .onError(({ code, error, set }) => {
      console.error("API Error:", code, error);

      switch (code) {
        case "NOT_FOUND":
          set.status = 404;
          return {
            error: "Not found",
            message: "The requested resource could not be found"
          };
        case "VALIDATION":
          set.status = 400;
          return {
            error: "Validation error",
            message: error.message
          };
        case "INTERNAL_SERVER_ERROR":
          set.status = 500;
          return {
            error: "Internal server error",
            message: "Something went wrong"
          };
        default:
          set.status = 500;
          return {
            error: "Unknown error",
            message: "An unexpected error occurred"
          };
      }
    });
};
