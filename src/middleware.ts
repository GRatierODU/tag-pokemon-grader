import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Dev tunnels (Cloudflare Quick Tunnels, ngrok, etc.) terminate TLS at the edge
 * and forward HTTP to localhost. Next must see x-forwarded-proto=https or it
 * may emit http:// absolute URLs / ws:// HMR — Safari then shows "Not Secure".
 */
const TUNNEL_HOST_SUFFIXES = [
  ".trycloudflare.com",
  ".loca.lt",
  ".ngrok.io",
  ".ngrok-free.app",
  ".ngrok.app",
] as const;

function isDevTunnelHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (!h) return false;
  return TUNNEL_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!isDevTunnelHost(host)) {
    return NextResponse.next();
  }

  const headers = new Headers(request.headers);
  headers.set("x-forwarded-proto", "https");
  if (!headers.has("x-forwarded-host")) {
    headers.set("x-forwarded-host", host);
  }

  return NextResponse.next({
    request: { headers },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
