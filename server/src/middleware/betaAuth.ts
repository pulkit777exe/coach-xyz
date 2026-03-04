import { Elysia } from "elysia"

const VALID_CODES = (process.env.BETA_CODES ?? "")
  .split(",")
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean)

export const betaAuth = new Elysia({ name: "beta-auth" }).onRequest(
  ({ request, set }) => {
    // Skip health check — monitoring tools don't send codes
    const url = new URL(request.url)
    if (url.pathname === "/health") return

    const code = (request.headers.get("x-beta-code") ?? "").trim().toLowerCase()

    if (!code || !VALID_CODES.includes(code)) {
      set.status = 401
      return {
        error: "INVALID_BETA_CODE",
        message: "Invalid or missing beta access code.",
      }
    }
  },
)
