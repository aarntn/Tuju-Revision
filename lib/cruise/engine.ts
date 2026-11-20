import { createTurnCaller, type Maneuver, type NextTurn, type TurnCue } from "../directions";
import { pointAt, type RouteLine } from "../route";
import { cruiseConfig, type CruiseConfig } from "./config";
import { createIntent } from "./intent";
import { createLookahead, type Alert, type LookaheadResult, type RouteEvent, type Utterance, type VoiceLevel } from "./lookahead";
import { send, type CruiseState } from "./machine";
import { createPipeline, type Fix } from "./pipeline";

export type CruiseSource = "gps" | "sim";

/** Everything the screen needs, recomputed on every accepted fix. */
export type CruiseSnapshot = {
  state: CruiseState;
  source: CruiseSource | null;
  km: number | null;
  remainingKm: number | null;
  speedKmh: number;
  /** Estimated arrival on the fix clock (ms). An estimate from current speed, never live traffic. */
  etaMs: number | null;
  offRouteM: number;
  /** Where to draw the car: on the route while on it, at the real position while off it. [lng, lat] */
  point: [number, number] | null;
  course: number | null;
  fraction: number | null;
  alerts: Alert[];
  reached: LookaheadResult["reached"];
  speak: Utterance | null;
  cardsSuppressed: boolean;
  /** The next turn on the route, while on it. */
  turn: NextTurn | null;
  /** A turn instruction to say now (each stage once per turn). */
  turnCue: TurnCue | null;
  arrived: boolean;
  lastFixT: number;
};

const LIVE: CruiseState[] = ["ARMED", "CRUISING", "OFF_ROUTE", "ARRIVING"];
const ARRIVED_KM = 0.1;

/**
 * The whole cruise pipeline in one pure object: filter → smooth → snap → intent → state machine → look-ahead.
 * It never touches React, the map, the network or the clock; the position source (a phone or the simulator) feeds it fixes.
 */
export function createCruise({ line, routeKm, events, maneuvers = [], cfg = cruiseConfig }: {
  line: RouteLine; routeKm: number; events: RouteEvent[]; maneuvers?: Maneuver[]; cfg?: CruiseConfig;
}) {
  const pipeline = createPipeline(line, cfg);
  const intent = createIntent(cfg);
  const lookahead = createLookahead(events, cfg);
  const turns = createTurnCaller(maneuvers);
  let state: CruiseState = "IDLE";
  let source: CruiseSource | null = null;
  let current: CruiseSnapshot = blank();

  function blank(): CruiseSnapshot {
    return {
      state, source, km: null, remainingKm: null, speedKmh: 0, etaMs: null, offRouteM: 0, point: null, course: null,
      fraction: null, alerts: [], reached: [], speak: null, cardsSuppressed: false, turn: null, turnCue: null, arrived: false, lastFixT: 0,
    };
  }
  const publish = (patch: Partial<CruiseSnapshot> = {}) => (current = { ...current, ...patch, state, source });

  return {
    snapshot: () => current,
    start() {
      if (state === "IDLE") { state = send(state, "START"); source = "gps"; }
      return publish();
    },
    simulate() {
      if (state === "IDLE") { state = send(state, "SIMULATE"); source = "sim"; }
      return publish();
    },
    exit() {
      state = send(state, "EXIT");
      return publish({ alerts: [], reached: [], speak: null, turn: null, turnCue: null });
    },
    push(fix: Fix, controls: { voice: VoiceLevel; muted: boolean }): CruiseSnapshot {
      if (!LIVE.includes(state)) return current;
      const snapped = pipeline.push(fix);
      if (!snapped) return current; // too inaccurate: ignore it entirely

      const event = intent.step(state, snapped);
      if (event) state = send(state, event);

      const looking = state === "CRUISING" || state === "ARRIVING";
      const ahead = looking
        ? lookahead.update({ km: snapped.km, speedMps: snapped.speed, now: fix.t, voice: controls.voice, muted: controls.muted })
        : { alerts: [], reached: [], speak: null, cardsSuppressed: false };
      const directions = looking ? turns.update(snapped.km, snapped.speed) : { next: null, cue: null };
      const offRoute = state === "OFF_ROUTE";
      return publish({
        km: snapped.km, remainingKm: snapped.remainingKm, speedKmh: snapped.speed * 3.6,
        etaMs: fix.t + ((snapped.remainingKm * 1000) / Math.max(snapped.speed, cfg.minEtaSpeed)) * 1000,
        offRouteM: snapped.offM,
        point: offRoute ? [snapped.lng, snapped.lat] : pointAt(line, Math.min(snapped.km, routeKm)),
        course: snapped.heading, fraction: Math.min(1, snapped.km / routeKm),
        arrived: state === "ARRIVING" && snapped.remainingKm < ARRIVED_KM,
        turn: directions.next, turnCue: directions.cue,
        lastFixT: fix.t, ...ahead,
      });
    },
  };
}
