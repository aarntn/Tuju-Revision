/**
 * Saves OSRM turn steps for a curated route, so its turn-by-turn directions work offline.
 * The curated line is itself an OSRM route between the configured endpoints; this asks the same server for the same
 * route with steps. Usage: npx tsx scripts/build-steps.ts [routeId]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compactSteps, OsrmResponse } from "../lib/routing";

const id = process.argv[2] ?? "kl-ipoh";
const dir = join(process.cwd(), "data", "routes", id);
const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
const line = JSON.parse(readFileSync(join(dir, "route.geojson"), "utf8"));
const { origin, destination } = config;
const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=simplified&geometries=geojson&alternatives=false&steps=true`;

async function main() {
const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`OSRM answered ${response.status}`);
const parsed = OsrmResponse.parse(await response.json());
const route = parsed.routes[0];
if (!route) throw new Error("No route");
const saved = Number(line.properties.distance_m);
const drift = Math.abs(route.distance - saved) / saved;
if (drift > 0.02) throw new Error(`OSRM's route is ${(drift * 100).toFixed(1)}% different from the saved line; rebuild the line first.`);
const steps = compactSteps(route.legs);
writeFileSync(join(dir, "steps.json"), JSON.stringify({
  routeId: id, source: "OSRM public demo (router.project-osrm.org), OpenStreetMap data © OSM contributors",
  source_url: url, retrieved_at: new Date().toISOString(), distance_m: route.distance, steps,
}, null, 1) + "\n");
console.log(`saved ${steps.length} steps for ${id} (route ${Math.round(route.distance)} m, saved line ${Math.round(saved)} m)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
