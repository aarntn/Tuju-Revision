import { makeProjector } from "./enrich";
import { t, type Key, type Lang } from "./i18n";
import type { RouteLine } from "./route";
import type { RouteStep } from "./routing";

/** A turn instruction placed on our own route line. `km` is distance along that line, like every other cruise event. */
export type Maneuver = {
  id: string; km: number; type: string; modifier?: string; exit?: number; road: string;
  lng: number; lat: number;
};

/** The arrow to draw for a manoeuvre. */
export type TurnIcon = "left" | "right" | "slight-left" | "slight-right" | "sharp-left" | "sharp-right" | "uturn" | "straight" | "roundabout" | "arrive";

export type TurnStage = "far" | "near" | "now";
export type TurnCue = { maneuver: Maneuver; then: Maneuver | null; stage: TurnStage; distKm: number };
export type NextTurn = { maneuver: Maneuver; then: Maneuver | null; distKm: number };

/** OSRM steps that only rename the road, or say nothing a driver acts on. */
const SILENT = new Set(["depart", "new name", "notification", "use lane"]);
/** A step this far (m) from our line does not belong to it (the line is thinned, so allow some slack). */
const MAX_OFF_M = 150;
/** Two manoeuvres closer than this (km) are announced together ("…, then turn right"). */
const THEN_KM = 0.15;
/** Passing a manoeuvre by this much (km) moves on to the next one. */
const PASSED_KM = 0.015;

export function stepsOf(line: RouteLine): RouteStep[] {
  const steps = line.properties?.steps;
  return Array.isArray(steps) ? (steps as RouteStep[]) : [];
}

/**
 * Places OSRM steps on our (thinned) route line. Each step is snapped near where OSRM's own distance says it should be,
 * so a road that passes close to itself cannot pull a turn onto the wrong stretch.
 */
export function buildManeuvers(line: RouteLine, steps: RouteStep[] = stepsOf(line)): Maneuver[] {
  if (!steps.length) return [];
  const { project, totalKm } = makeProjector(line);
  const osrmKm = Number(line.properties?.distance_m) / 1000 || totalKm;
  const scale = totalKm / osrmKm;
  const out: Maneuver[] = [];
  steps.forEach((step, index) => {
    if (SILENT.has(step.type)) return;
    if (step.type === "continue" && (!step.modifier || step.modifier === "straight")) return;
    const estimate = (step.along_m / 1000) * scale;
    const slack = Math.max(0.5, estimate * 0.03);
    const spot = step.type === "arrive"
      ? { km: totalKm, offM: 0 }
      : project(step.lng, step.lat, { from: estimate - slack, to: estimate + slack });
    if (spot.offM > MAX_OFF_M) return;
    out.push({
      id: `m${index}`, km: spot.km, type: step.type,
      ...(step.modifier ? { modifier: step.modifier } : {}),
      ...(step.exit !== undefined ? { exit: step.exit } : {}),
      road: roadName(step), lng: step.lng, lat: step.lat,
    });
  });
  return out.sort((a, b) => a.km - b.km);
}

function roadName(step: RouteStep): string {
  if (step.name) return step.ref && !step.name.includes(step.ref) ? `${step.name} (${step.ref})` : step.name;
  if (step.ref) return step.ref;
  return step.destinations?.split(":").pop()?.split(",")[0].trim() ?? "";
}

export function turnIcon(m: Pick<Maneuver, "type" | "modifier">): TurnIcon {
  if (m.type === "arrive") return "arrive";
  if (m.type === "roundabout" || m.type === "rotary" || m.type === "roundabout turn" || m.type === "exit roundabout") return "roundabout";
  switch (m.modifier) {
    case "left": return "left";
    case "right": return "right";
    case "slight left": return "slight-left";
    case "slight right": return "slight-right";
    case "sharp left": return "sharp-left";
    case "sharp right": return "sharp-right";
    case "uturn": return "uturn";
    default: return "straight";
  }
}

const ordinal = (lang: Lang, n: number) => {
  if (lang === "bm") return String(n);
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${tail}`;
};

const MODIFIER_KEY: Record<string, Key> = {
  left: "turnLeft", right: "turnRight", "slight left": "turnSlightLeft", "slight right": "turnSlightRight",
  "sharp left": "turnSharpLeft", "sharp right": "turnSharpRight", uturn: "turnUturn", straight: "turnStraight",
};

function action(lang: Lang, m: Maneuver): string {
  const left = m.modifier?.includes("left");
  switch (m.type) {
    case "off ramp": return t(lang, left ? "turnExitLeft" : "turnExitRight");
    case "on ramp": return t(lang, "turnRamp");
    case "fork": return t(lang, left ? "turnKeepLeft" : "turnKeepRight");
    case "merge": return t(lang, "turnMerge");
    case "roundabout": case "rotary": case "roundabout turn": case "exit roundabout":
      return m.exit ? t(lang, "turnRoundabout", { n: ordinal(lang, m.exit) }) : t(lang, "turnRoundaboutPlain");
    default: return t(lang, MODIFIER_KEY[m.modifier ?? "straight"] ?? "turnStraight");
  }
}

/** "Turn right onto Jalan Sultan Nazrin Shah". `destination` names the end of the route. */
export function instruction(lang: Lang, m: Maneuver, destination = ""): string {
  if (m.type === "arrive") return t(lang, "turnArrive", { place: destination || m.road });
  const verb = action(lang, m);
  return m.road ? t(lang, "turnOnto", { action: verb, road: m.road }) : verb;
}

/** Spoken distance: "2 km", "300 m". Rounded the way people say it. */
export function spokenDistance(lang: Lang, km: number): string {
  if (km >= 1) return t(lang, "cruiseKm", { n: km >= 10 ? Math.round(km) : Math.round(km * 2) / 2 });
  return t(lang, "cruiseMetres", { n: Math.max(50, Math.round(km * 20) * 50) });
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The full spoken line for a cue: "In 300 m, turn right onto Jalan Duta, then keep left". */
export function cuePhrase(lang: Lang, cue: TurnCue, destination = ""): string {
  const first = instruction(lang, cue.maneuver, destination);
  const lead = cue.stage === "now" ? first : t(lang, "turnIn", { d: spokenDistance(lang, cue.distKm), action: lower(first) });
  return cue.then && cue.stage !== "far" ? t(lang, "turnThen", { first: lead, second: lower(instruction(lang, cue.then, destination)) }) : lead;
}

/** The manoeuvre ahead of `km`, and the one right after it when they come close together. */
export function nextTurn(maneuvers: Maneuver[], km: number): NextTurn | null {
  const index = maneuvers.findIndex((m) => m.km > km + PASSED_KM);
  if (index < 0) return null;
  const maneuver = maneuvers[index];
  const after = maneuvers[index + 1];
  // "Keep right, then keep right" says nothing new; the second one is announced on its own once the first is passed.
  const repeats = after && after.type === maneuver.type && after.modifier === maneuver.modifier && after.road === maneuver.road;
  const then = after && !repeats && after.km - maneuver.km < THEN_KM ? after : null;
  return { maneuver, then, distKm: Math.max(0, maneuver.km - km) };
}

/** When to speak, by speed: earlier warnings on the highway, tighter ones in town. */
export function cueDistances(speedMps: number): Record<TurnStage, number> {
  const highway = speedMps >= 70 / 3.6;
  return highway
    ? { far: 2, near: 0.5, now: Math.max(0.15, (speedMps * 6) / 1000) }
    : { far: 0.8, near: 0.2, now: Math.max(0.05, (speedMps * 5) / 1000) };
}

const STAGES: TurnStage[] = ["far", "near", "now"];

/**
 * Pure turn caller: on each position update it reports the next manoeuvre and, at most once per stage per manoeuvre,
 * a cue to speak. Reaching a later stage first (a short gap between turns) skips the earlier ones.
 */
export function createTurnCaller(maneuvers: Maneuver[]) {
  const said = new Map<string, number>();
  return {
    update(km: number, speedMps: number): { next: NextTurn | null; cue: TurnCue | null } {
      const next = nextTurn(maneuvers, km);
      if (!next) return { next, cue: null };
      const limits = cueDistances(speedMps);
      let reached = -1;
      STAGES.forEach((stage, index) => { if (next.distKm <= limits[stage]) reached = index; });
      const before = said.get(next.maneuver.id) ?? -1;
      if (reached <= before) return { next, cue: null };
      said.set(next.maneuver.id, reached);
      // An arrival is said once, close by; the arrival screen does the rest.
      if (next.maneuver.type === "arrive" && STAGES[reached] === "far") return { next, cue: null };
      return { next, cue: { maneuver: next.maneuver, then: next.then, stage: STAGES[reached], distKm: next.distKm } };
    },
  };
}
