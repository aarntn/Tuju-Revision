import type { RouteBundle } from "./data";
import { enrichRoute, overlapShare } from "./enrich";
import type { Place } from "./places";
import { routeLengthKm, type RouteLine } from "./route";
import type { RouteOption } from "./routing";
import type { RnrFile, RouteConfig, TollFile } from "./schemas";

/** Weather and prayer zones come from the curated corridor, so they only apply when the trip mostly follows it. */
const CORRIDOR_SHARE = 0.6;
/** The highway is named in the trip header only when at least this much of the trip follows it. */
const NAME_SHARE = 0.5;
/** At or above this share of the route on the corridor, the corridor's tolls are the whole toll story. */
const WHOLE_SHARE = 0.9;

/** The verified corridor the app ships with. The weather gazetteer stays on the server. */
export type CuratedBundle = Pick<RouteBundle, "config" | "line" | "rnr" | "tolls">;

export type TripRoute = {
  key: string;
  config: RouteConfig;
  line: RouteLine;
  rnr: RnrFile;
  tolls: TollFile;
  routeKm: number;
  /** Verified corridor data (stops and toll plazas) was found along this route. */
  curated: boolean;
  /** True when the route has curated stops to plan with. Otherwise the planner offers evenly spaced breaks. */
  hasVerifiedStops: boolean;
  /** Curated weather and prayer-zone data apply to this route. */
  corridorWeather: boolean;
  /** The route runs beyond the stretch our toll data covers, so any toll shown is a lower bound. */
  tollPartial: boolean;
  source: string;
};

/** Two places plus a route option become the exact bundle the trip planner already understands. */
export function buildTripRoute({ from, to, option, source, fetchedAt, curated }: {
  from: Place; to: Place; option: RouteOption; source: string; fetchedAt: string; curated: CuratedBundle;
}): TripRoute {
  const key = `${from.lat},${from.lng}>${to.lat},${to.lng}#${option.id}`;
  const line: RouteLine = {
    type: "Feature",
    properties: {
      routeId: key, distance_m: option.distance_m, duration_s_freeflow: option.duration_s,
      source, source_url: "https://project-osrm.org/", retrieved_at: fetchedAt, verified: false,
      ...(option.steps ? { steps: option.steps } : {}),
    },
    geometry: { type: "LineString", coordinates: option.geometry.coordinates },
  };
  const found = enrichRoute(line, curated);
  const hasPlazas = found.tolls.plazas.length > 0;
  const share = overlapShare(line, curated.line);
  const corridorWeather = share >= CORRIDOR_SHARE;
  const name = `${from.name} → ${to.name}`;

  const config: RouteConfig = {
    id: key,
    name: { en: name, bm: name },
    highway: hasPlazas && share >= NAME_SHARE ? curated.config.highway : "Driving route",
    direction: "",
    origin: { name: from.name, lat: from.lat, lng: from.lng },
    destination: { name: to.name, lat: to.lat, lng: to.lng },
    via: [],
    prayerZones: corridorWeather ? curated.config.prayerZones : [],
    weatherLocations: corridorWeather ? curated.config.weatherLocations : [],
    links: hasPlazas ? curated.config.links : {},
  };
  return {
    key, config, line,
    rnr: { ...curated.rnr, routeId: key, items: found.stops },
    tolls: { ...found.tolls, routeId: key, note: found.tolls.note + " Plazas matched to this route automatically; fares only where PLUS published them." },
    routeKm: routeLengthKm(line),
    curated: found.stops.length > 0 || found.tolls.plazas.length >= 2,
    hasVerifiedStops: found.stops.length > 0,
    corridorWeather,
    tollPartial: found.tolls.plazas.length >= 2 && share < WHOLE_SHARE,
    source,
  };
}
