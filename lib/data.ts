/**
 * Route registry. Adding a route = add a folder under data/routes/<id>/ and one import line here.
 * (Static imports keep the data bundled + cacheable offline; no fs at runtime.)
 */
import klIpohConfig from "@/data/routes/kl-ipoh/config.json";
import klIpohRoute from "@/data/routes/kl-ipoh/route.geojson";
import klIpohRnr from "@/data/routes/kl-ipoh/rnr.json";
import klIpohTolls from "@/data/routes/kl-ipoh/tolls.json";
import klIpohGaz from "@/data/routes/kl-ipoh/gazetteer.json";
import klIpohSteps from "@/data/routes/kl-ipoh/steps.json";
import { RnrFile, RouteConfig, TollFile } from "./schemas";
import type { RouteLine } from "./route";
import type { RouteStep } from "./routing";

export type Gazetteer = { source_url: string; retrieved_at: string; verified: boolean; places: { id: string; name: string; lat: number; lng: number; km: number; state: string }[] };

export type RouteBundle = {
  config: RouteConfig;
  line: RouteLine;
  rnr: RnrFile;
  tolls: TollFile;
  gazetteer: Gazetteer;
};

const raw = {
  "kl-ipoh": { config: klIpohConfig, line: klIpohRoute, rnr: klIpohRnr, tolls: klIpohTolls, gazetteer: klIpohGaz, steps: klIpohSteps },
} as const;

export type RouteId = keyof typeof raw;
export const ROUTE_IDS = Object.keys(raw) as RouteId[];
export const DEFAULT_ROUTE: RouteId = "kl-ipoh";

const cache = new Map<string, RouteBundle>();
export function getRoute(id: string = DEFAULT_ROUTE): RouteBundle {
  // explicit allowlist (not `in`, which would accept prototype keys like "toString")
  const key: RouteId = (ROUTE_IDS as string[]).includes(id) ? (id as RouteId) : DEFAULT_ROUTE;
  if (cache.has(key)) return cache.get(key)!;
  const r = raw[key];
  const bundle: RouteBundle = {
    config: RouteConfig.parse(r.config),
    // Turn steps travel on the line, like OSRM routes fetched at runtime (see lib/trip-route.ts).
    line: withSteps(r.line as unknown as RouteLine, r.steps.steps as RouteStep[]),
    rnr: RnrFile.parse(r.rnr),
    tolls: TollFile.parse(r.tolls),
    gazetteer: r.gazetteer as Gazetteer,
  };
  cache.set(key, bundle);
  return bundle;
}

function withSteps(line: RouteLine, steps: RouteStep[]): RouteLine {
  return { ...line, properties: { ...line.properties, steps } };
}
