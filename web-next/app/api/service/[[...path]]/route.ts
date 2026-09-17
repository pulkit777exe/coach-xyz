import { auth0 } from "@/lib/auth0";
import { isIdentityPath } from "@/lib/serviceProxy";
import { NextRequest, NextResponse } from "next/server";

// ── Service proxy for identity-bearing backend routes ──────────────────────
// The browser only talks to these through this same-origin handler. It reads
// the verified Auth0 session, then injects x-service-token + x-verified-auth0-id
// (the session's sub) before forwarding to the backend (which authorizes both
// the owner and active org members via serviceGuard's membership check).
//
// Only identity-bearing routes are proxied. Capability-token routes
// (scan/analyze/job-status/download/chat) stay direct-browser→backend so
// uploads and SSE streams never pass through Vercel.

const BACKEND = process.env.NEXT_PUBLIC_API_URL;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
]);

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: NextRequest, ctx: RouteContext) {
  if (!BACKEND) {
    return NextResponse.json({ message: "Backend not configured." }, { status: 500 });
  }

  const path = (await ctx.params).path ?? [];
  if (!isIdentityPath(path)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }

  const session = await auth0.getSession();
  const verifiedSub = session?.user?.sub;
  if (!verifiedSub) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let body: ArrayBuffer | undefined;
  if (hasBody) {
    body = await request.arrayBuffer();
  }

  // The backend is the authorizer: it accepts the org owner OR any active
  // org_members row for the org named by the path. Path-scoped ids are no
  // longer compared against the session sub here — the session sub is the
  // caller's true identity and membership is resolved server-side.
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (process.env.SERVICE_TOKEN) headers.set("x-service-token", process.env.SERVICE_TOKEN);
  headers.set("x-verified-auth0-id", verifiedSub);

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/${path.join("/")}`, {
      method: request.method,
      headers,
      body: hasBody ? body : undefined,
      redirect: "manual",
    });
  } catch {
    return NextResponse.json(
      { message: "Backend service is temporarily unavailable." },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers(backendRes.headers);
  for (const name of HOP_BY_HOP) responseHeaders.delete(name);

  return new Response(backendRes.body, {
    status: backendRes.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx);
}
export async function POST(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx);
}
export async function PUT(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx);
}
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx);
}
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx);
}