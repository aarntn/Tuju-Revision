import { NextResponse } from "next/server";
import { cachedFetch, cdnHeaders } from "@/lib/cache";
import { makeLimiter } from "@/lib/limiter";
import { normalizeOsrm, OsrmResponse, parsePoint, routeCacheKey } from "@/lib/routing";

export const dynamic = "force-dynamic";
const TTL = 6 * 3600_000;
// The OSRM demo server is free and shared. Cap upstream calls per instance; cache hits are unlimited.
const limiter = makeLimiter({ max: 40, perMs: 60_000 });
class RateLimited extends Error {}
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const from = parsePoint(params.get("from")), to = parsePoint(params.get("to"));
  if (!from || !to) return NextResponse.json({ error: "invalid-points" }, { status: 400, headers: noStore });
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=true&steps=true`;
  try {
    const result = await cachedFetch({
      key: routeCacheKey(from, to), url, ttlMs: TTL, schema: OsrmResponse, timeoutMs: 12_000,
      beforeFetch: () => { if (!limiter.take()) throw new RateLimited(); },
    });
    const routes = normalizeOsrm(result.data);
    if (!routes.length) return NextResponse.json({ error: "no-route" }, { status: 404, headers: noStore });
    return NextResponse.json(
      { routes, source: "OSRM public demo, OpenStreetMap data", status: result.status, fetchedAt: result.fetchedAt },
      { headers: cdnHeaders(600) },
    );
  } catch (error) {
    if (error instanceof RateLimited) {
      const wait = limiter.retryAfterMs();
      return NextResponse.json({ error: "busy", retryAfterMs: wait }, { status: 429, headers: { ...noStore, "Retry-After": String(Math.ceil(wait / 1000)) } });
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  }
}
