import type { RouteLine } from "./route";
import type { RnrFile, Stop, TollFile } from "./schemas";

type Plaza = TollFile["plazas"][number];

/** A stop or plaza belongs to a route only if the route passes this close. Plazas sit on ramps, so they get more room. */
const MAX_STOP_OFF_M = 450;
const MAX_PLAZA_OFF_M = 600;
/** Direction a facility serves, as a compass heading. Travelling the opposite way means it is on the wrong carriageway. */
const HEADING: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
const HEADING_TOLERANCE = 75;
const EARTH_KM = 6371.0088;

const round2 = (value: number) => Math.round(value * 100) / 100;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: number[], b: number[]) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Fast nearest-point-on-line for one line, using a local flat approximation (accurate to well under a metre at
 * these distances). turf.nearestPointOnLine is far too slow to call hundreds of times.
 */
export function makeProjector(line: RouteLine) {
  const c = line.geometry.coordinates;
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + haversineKm(c[i - 1], c[i]));
  return {
    totalKm: cum[cum.length - 1],
    /** Nearest point on the line. With `window`, only that stretch (km along the line) is searched, so a route that passes close to itself cannot snap to the wrong branch. */
    project(lng: number, lat: number, window?: { from: number; to: number }) {
      const k = Math.cos(rad(lat)) * 111320;
      let best = Infinity, index = 0, along = 0, bearing = 0;
      for (let i = 0; i < c.length - 1; i++) {
        if (window && (cum[i + 1] < window.from || cum[i] > window.to)) continue;
        const ax = (c[i][0] - lng) * k, ay = (c[i][1] - lat) * 110540;
        const dx = (c[i + 1][0] - c[i][0]) * k, dy = (c[i + 1][1] - c[i][1]) * 110540;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const d2 = px * px + py * py;
        if (d2 < best) { best = d2; index = i; along = t; bearing = (Math.atan2(dx, dy) * 180) / Math.PI; }
      }
      return { km: cum[index] + along * (cum[index + 1] - cum[index]), offM: Math.sqrt(best), bearing };
    },
  };
}

function headingFits(direction: string, bearing: number): boolean {
  const expected = HEADING[direction.toLowerCase()];
  if (expected === undefined) return true; // unknown direction label: do not hide a real stop
  return Math.abs(((bearing - expected + 540) % 360) - 180) <= HEADING_TOLERANCE;
}

/** Points along a line at a fixed spacing, with their distance from the start. Fixed spacing means no long segment is judged by one point. */
function sampleLine(line: RouteLine, stepKm = 0.2) {
  const c = line.geometry.coordinates;
  const out: { lng: number; lat: number; km: number }[] = [];
  let km = 0;
  for (let i = 1; i < c.length; i++) {
    const seg = haversineKm(c[i - 1], c[i]);
    const steps = Math.max(1, Math.ceil(seg / stepKm));
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      out.push({ lng: c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, lat: c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f, km: km + seg * f });
    }
    km += seg;
  }
  const last = c[c.length - 1];
  out.push({ lng: last[0], lat: last[1], km });
  return out;
}

/**
 * Stretches of the reference corridor (as kilometres along the reference) that this route demonstrably follows:
 * within `tolM` of the reference line for at least `minRunKm` in a row. A road merely running beside a highway is not it.
 */
export function corridorUse(line: RouteLine, reference: RouteLine, tolM = 100, minRunKm = 1): [number, number][] {
  const { project } = makeProjector(reference);
  const samples = sampleLine(line);
  const intervals: [number, number][] = [];
  let start = -1, a = 0, b = 0;
  const close = (endIndex: number) => {
    if (start >= 0 && samples[endIndex].km - samples[start].km >= minRunKm) intervals.push([Math.min(a, b), Math.max(a, b)]);
    start = -1;
  };
  samples.forEach((sample, index) => {
    const spot = project(sample.lng, sample.lat);
    if (spot.offM <= tolM) {
      if (start < 0) { start = index; a = spot.km; }
      b = spot.km;
    } else close(index - 1);
  });
  close(samples.length - 1);
  return intervals;
}

/**
 * Curated, hand-checked data becomes an enhancement for any route that follows the curated corridor: keep the R&Rs
 * and toll plazas on the stretches the route actually uses (R&Rs also only on the carriageway it is travelling),
 * re-measured along the new line. Nothing is invented and the curated files are never changed.
 */
export function enrichRoute(line: RouteLine, curated: { rnr: RnrFile; tolls: TollFile; line: RouteLine }) {
  const onRoute = makeProjector(line).project;
  const onCorridor = makeProjector(curated.line).project;
  const used = corridorUse(line, curated.line);
  const inUse = (km: number) => used.some(([from, to]) => km >= from - 1 && km <= to + 1);

  const stops: Stop[] = [];
  for (const stop of curated.rnr.items) {
    const spot = onRoute(stop.lng, stop.lat);
    if (spot.offM > MAX_STOP_OFF_M || !headingFits(stop.direction, spot.bearing) || !inUse(onCorridor(stop.lng, stop.lat).km)) continue;
    stops.push({ ...stop, distanceAlongRoute_km: round2(spot.km) });
  }
  stops.sort((a, b) => a.distanceAlongRoute_km - b.distanceAlongRoute_km);

  const plazas: Plaza[] = [];
  for (const plaza of curated.tolls.plazas) {
    const spot = onRoute(plaza.lng, plaza.lat);
    if (spot.offM > MAX_PLAZA_OFF_M || !inUse(onCorridor(plaza.lng, plaza.lat).km)) continue;
    plazas.push({ ...plaza, distanceAlongRoute_km: round2(spot.km) });
  }
  plazas.sort((a, b) => a.distanceAlongRoute_km - b.distanceAlongRoute_km);

  const kept = new Set(plazas.map((p) => p.id));
  const fares: TollFile["fares"] = {};
  for (const [entry, row] of Object.entries(curated.tolls.fares)) {
    if (!kept.has(entry)) continue;
    fares[entry] = Object.fromEntries(Object.entries(row).filter(([exit]) => kept.has(exit)));
  }
  return { stops, tolls: { ...curated.tolls, plazas, fares } as TollFile };
}

/** Share (0 to 1) of a route's length within `tolM` of a reference line, sampled every 200 m. Decides if corridor-only data applies. */
export function overlapShare(line: RouteLine, reference: RouteLine, tolM = 600): number {
  const { project } = makeProjector(reference);
  const samples = sampleLine(line);
  if (samples.length < 2) return 0;
  const near = samples.filter((sample) => project(sample.lng, sample.lat).offM <= tolM).length;
  return near / samples.length;
}
