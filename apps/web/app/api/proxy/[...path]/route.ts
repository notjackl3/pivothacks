import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Same-origin proxy for the Fastify API (which has no CORS plugin).
 * `/api/proxy/<path>?<query>` → `${API_BASE_URL}/api/<path>?<query>`, forwarding the method,
 * body and Authorization header; the upstream JSON body and status come back verbatim.
 */
function apiBaseUrl(): string {
  const raw = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
  return raw.replace(/\/+$/, "");
}

type RouteContext = { params: Promise<{ path: string[] }> };

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

async function forward(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { path } = await ctx.params;
  const segments = (path ?? []).map(encodeURIComponent).join("/");
  const target = new URL(`${apiBaseUrl()}/api/${segments}`);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  headers.set("accept", "application/json");
  const authorization = req.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  let body: ArrayBuffer | undefined;
  if (!BODYLESS_METHODS.has(req.method)) {
    const raw = await req.arrayBuffer();
    if (raw.byteLength > 0) body = raw;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "api_unreachable", message: `Could not reach the API at ${apiBaseUrl()} (${detail}).` } },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  const responseHeaders = new Headers();
  responseHeaders.set("cache-control", "no-store");
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) responseHeaders.set("content-type", upstreamType);
  const location = upstream.headers.get("location");
  if (location) responseHeaders.set("location", location);

  if (upstream.status === 204 || upstream.status === 304) {
    return new NextResponse(null, { status: upstream.status, headers: responseHeaders });
  }
  const text = await upstream.text();
  if (!upstreamType) responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new NextResponse(text, { status: upstream.status, headers: responseHeaders });
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  return forward(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  return forward(req, ctx);
}

export async function PUT(req: NextRequest, ctx: RouteContext): Promise<Response> {
  return forward(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
  return forward(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<Response> {
  return forward(req, ctx);
}
