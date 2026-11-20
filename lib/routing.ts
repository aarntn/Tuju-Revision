import { lineString, simplify } from "@turf/turf";
import { z } from "zod";
import { inMalaysia } from "./bounds";

export type Point = { lat: number; lng: number };
/** One OSRM turn instruction, kept small. `along_m` is metres from the route start to the manoeuvre (OSRM's own distances). */
export type RouteStep = {
  type: string; modifier?: string; exit?: number; name: string; ref?: string; destinations?: string;
  lng: number; lat: number; along_m: number;
};
export type RouteOption = {
  id: string; distance_m: number; duration_s: number; geometry: { type: "LineString"; coordinates: number[][] };
  steps?: RouteStep[];
};

export function parsePoint(text: string | null): Point | null {
  if (!text) return null;
  const parts = text.split(",");
  if (parts.length !== 2 || parts.some((part) => part.trim() === "")) return null;
  const [lat, lng] = parts.map(Number);
  if (!inMalaysia(lat, lng)) return null;
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  return { lat: round(lat), lng: round(lng) };
}

// v2: responses include turn steps, so older cached entries (without them) are not reused.
export const routeCacheKey = (from: Point, to: Point) => `route:v2:${from.lat},${from.lng}>${to.lat},${to.lng}`;

const OsrmStep = z.object({
  distance: z.number(),
  name: z.string().default(""),
  ref: z.string().optional(),
  destinations: z.string().optional(),
  rotary_name: z.string().optional(),
  maneuver: z.object({
    type: z.string(), modifier: z.string().optional(), exit: z.number().optional(),
    location: z.tuple([z.number(), z.number()]),
  }),
});
type OsrmLeg = { steps: z.infer<typeof OsrmStep>[] };

export const OsrmResponse = z.object({
  code: z.string(),
  routes: z.array(z.object({
    distance: z.number(), duration: z.number(),
    geometry: z.object({ type: z.literal("LineString"), coordinates: z.array(z.array(z.number()).min(2)) }),
    legs: z.array(z.object({ steps: z.array(OsrmStep).default([]) })).default([]),
  })).default([]),
});

/** Flattens OSRM legs into compact steps, each with the distance from the start of the route to its manoeuvre. */
export function compactSteps(legs: OsrmLeg[]): RouteStep[] {
  const out: RouteStep[] = [];
  let along = 0;
  for (const leg of legs) {
    for (const step of leg.steps) {
      const { type, modifier, exit, location } = step.maneuver;
      out.push({
        type,
        ...(modifier ? { modifier } : {}),
        ...(exit !== undefined ? { exit } : {}),
        name: step.rotary_name || step.name,
        ...(step.ref ? { ref: step.ref } : {}),
        ...(step.destinations ? { destinations: step.destinations } : {}),
        lng: location[0], lat: location[1], along_m: Math.round(along),
      });
      along += step.distance;
    }
  }
  return out;
}

/** OSRM to up to three route options, with the line thinned to about 30 m so phones can draw it. */
export function normalizeOsrm(json: unknown): RouteOption[] {
  const parsed = OsrmResponse.safeParse(json);
  if (!parsed.success || parsed.data.code !== "Ok") return [];
  return parsed.data.routes.slice(0, 3).map((route, index) => {
    const thin = route.geometry.coordinates.length > 2
      ? simplify(lineString(route.geometry.coordinates), { tolerance: 0.0003, highQuality: false }).geometry.coordinates
      : route.geometry.coordinates;
    const steps = compactSteps(route.legs);
    return {
      id: "r" + index, distance_m: route.distance, duration_s: route.duration,
      geometry: { type: "LineString", coordinates: thin },
      ...(steps.length ? { steps } : {}),
    };
  });
}
