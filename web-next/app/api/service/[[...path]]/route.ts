import { auth0 } from "@/lib/auth0";
import { decodePathSegment, isIdentityPath, isSelfPath, resourceAuth0Id } from "@/lib/serviceProxy";
import { NextRequest, NextResponse } from "next/server";

// ── Service proxy for identity-bearing backend routes ──────────────────────
// The browser only talks to these through this same-origin handler. It reads
// the verified Auth0 session, then injects x-service-token + x-verified-auth0-id
// before forwarding to the backend (which enforces the same check again).
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
  let bodySub: string | undefined;
  if (hasBody) {
    body = await request.arrayBuffer();
    if (!resourceAuth0Id(path)) {
      try {
        const parsed = JSON.parse(Buffer.from(body).toString("utf-8")) as { sub?: unknown };
        bodySub = typeof parsed.sub === "string" ? parsed.sub : undefined;
      } catch {
        // Not JSON — the backend will reject it.
      }
    }
  }

  const scopedResource = resourceAuth0Id(path);
  const resourceId = scopedResource
    ? decodePathSegment(scopedResource)
    : bodySub ?? (isSelfPath(path) ? verifiedSub : undefined);
  if (!resourceId || resourceId !== verifiedSub) {
    return NextResponse.json(
      { message: "Authenticated identity does not match the requested account." },
      { status: 403 },
    );
  }

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