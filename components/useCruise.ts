"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildManeuvers, cuePhrase, type TurnCue } from "@/lib/directions";
import { createCruise, type CruiseSnapshot } from "@/lib/cruise/engine";
import type { RouteEvent, VoiceLevel } from "@/lib/cruise/lookahead";
import type { Fix } from "@/lib/cruise/pipeline";
import { createSimulator } from "@/lib/cruise/simulator";
import { createVoice, phrase } from "@/lib/cruise/voice";
import { createWakeLock, type WakeStatus } from "@/lib/cruise/wakelock";
import type { DriveFrame, DrivePose } from "@/lib/drive-camera";
import { t, type Lang } from "@/lib/i18n";
import { rerouteLine, shiftEvents } from "@/lib/reroute";
import { routeLengthKm, type RouteLine } from "@/lib/route";
import type { RouteOption } from "@/lib/routing";

/** The simulator plays this many times faster than real time, so a 193 km demo drive takes about two minutes. */
const SIM_SPEEDUP = 60;
const SIM_TICK_MS = 250;
/** After a reroute attempt, wait this long (wall clock) before trying again. */
const REROUTE_COOLDOWN_MS = 20_000;
const REROUTE_TIMEOUT_MS = 10_000;

export type RerouteStatus = "idle" | "finding" | "found" | "failed";
type Destination = { name: string; lat: number; lng: number };

type Options = {
  line: RouteLine; routeKm: number; events: RouteEvent[]; slowZonesKm: number[]; lang: Lang;
  destination: Destination;
  onFrame: (frame: DriveFrame | null) => void;
  /** The drive now follows a different line (after a reroute), or `null` when the drive ends. */
  onLineChange?: (line: RouteLine | null) => void;
  /** The drive reached its destination (the user still taps Finish). */
  onArrived: () => void;
  onEnded: () => void;
};

const STAGE_RANK = { far: 0, near: 1, now: 2 } as const;
const moreUrgent = (a: TurnCue | null, b: TurnCue | null) => (!a ? b : !b ? a : STAGE_RANK[b.stage] >= STAGE_RANK[a.stage] ? b : a);

/**
 * Connects the pure cruise engine to the real world: the phone's GPS or the simulator, voice, the wake lock, the map and
 * the route server for rerouting. Location is read in the browser; only a reroute sends the current position, to our own
 * route API, to ask for a new route.
 */
export function useCruise(options: Options) {
  const opts = useRef(options);
  opts.current = options;

  const engine = useRef<ReturnType<typeof createCruise> | null>(null);
  const simulator = useRef<ReturnType<typeof createSimulator> | null>(null);
  const timer = useRef<number | null>(null);
  const watch = useRef<number | null>(null);
  const clockBase = useRef(0);
  const arrivedSent = useRef(false);
  const voice = useRef<ReturnType<typeof createVoice> | null>(null);
  const wake = useRef<ReturnType<typeof createWakeLock> | null>(null);
  const source = useRef<"gps" | "sim">("gps");
  /** Original-route km minus current-route km. Snapshots report km on the original route, so stops and tolls still line up. */
  const kmShift = useRef(0);
  const reroute = useRef<{ busy: boolean; lastAt: number; controller: AbortController | null }>({ busy: false, lastAt: 0, controller: null });

  const [snapshot, setSnapshot] = useState<CruiseSnapshot | null>(null);
  const [muted, setMutedState] = useState(false);
  const [voiceLevel, setVoiceLevelState] = useState<VoiceLevel>("normal");
  const [headingUp, setHeadingUp] = useState(true);
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>("idle");
  const [voiceInfo, setVoiceInfo] = useState({ available: true, fellBack: false });
  const [gpsError, setGpsError] = useState(false);
  /** The GPS stopped reporting (tunnel, weak signal). Transient: the drive carries on and recovers by itself. */
  const [gpsLost, setGpsLost] = useState(false);
  const [rerouteStatus, setRerouteStatus] = useState<RerouteStatus>("idle");
  const controls = useRef({ voice: "normal" as VoiceLevel, muted: false });

  const say = useCallback((text: string, interrupt: boolean) => { voice.current?.speak(text, { interrupt }); }, []);

  const makeEngine = useCallback((line: RouteLine, routeKm: number, events: RouteEvent[]) => {
    const cruise = createCruise({ line, routeKm, events, maneuvers: buildManeuvers(line) });
    if (source.current === "sim") cruise.simulate(); else cruise.start();
    return cruise;
  }, []);

  // Defined below; publish needs to start a reroute and the reroute needs to publish.
  const startReroute = useRef<(from: [number, number]) => void>(() => {});

  const publish = useCallback((raw: CruiseSnapshot, replay?: DriveFrame["replay"]) => {
    const next = raw.km === null ? raw : { ...raw, km: raw.km + kmShift.current };
    setSnapshot(next);
    if (next.point) {
      opts.current.onFrame({ point: next.point, course: next.course, fraction: next.fraction, speedKmh: next.speedKmh, replay });
    }
    const { lang, destination } = opts.current;
    // A close turn instruction outranks a rest-stop line; a far one waits its turn.
    if (next.turnCue) say(cuePhrase(lang, next.turnCue, destination.name), next.turnCue.stage !== "far");
    else if (next.speak) say(phrase(lang, next.speak), next.speak.interrupt);
    if (next.state === "OFF_ROUTE" && next.point) startReroute.current(next.point);
    if (next.arrived && !arrivedSent.current) { arrivedSent.current = true; opts.current.onArrived(); }
  }, [say]);

  startReroute.current = (from) => {
    const state = reroute.current;
    if (state.busy || Date.now() - state.lastAt < REROUTE_COOLDOWN_MS || !engine.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setRerouteStatus("failed"); return; }
    state.busy = true;
    state.lastAt = Date.now();
    setRerouteStatus("finding");
    const { lang, destination } = opts.current;
    say(t(lang, "rerouting"), false);
    const controller = new AbortController();
    state.controller = controller;
    const timeout = window.setTimeout(() => controller.abort(), REROUTE_TIMEOUT_MS);
    const [lng, lat] = from;
    fetch(`/api/route?from=${lat.toFixed(5)},${lng.toFixed(5)}&to=${destination.lat},${destination.lng}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body: { routes: RouteOption[]; source: string; fetchedAt: string } = await response.json();
        const option = body.routes[0];
        if (!option || !engine.current) throw new Error("no-route");
        const { routeKm: originalKm, events } = opts.current;
        const newLine = rerouteLine(option, body.source, body.fetchedAt);
        const newKm = routeLengthKm(newLine);
        kmShift.current = originalKm - newKm;
        engine.current = makeEngine(newLine, newKm, shiftEvents(events, originalKm, newKm));
        opts.current.onLineChange?.(newLine);
        setRerouteStatus("found");
        say(t(lang, "rerouted"), true);
      })
      // A drive that ended meanwhile has nothing to report.
      .catch(() => { if (engine.current) setRerouteStatus("failed"); })
      .finally(() => { window.clearTimeout(timeout); state.busy = false; state.controller = null; });
  };

  const stopSources = useCallback(() => {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
    if (watch.current !== null) { navigator.geolocation?.clearWatch(watch.current); watch.current = null; }
  }, []);

  const exit = useCallback(() => {
    stopSources();
    reroute.current.controller?.abort();
    voice.current?.cancel();
    void wake.current?.release();
    const final = engine.current?.exit();
    engine.current = null;
    simulator.current = null;
    arrivedSent.current = false;
    kmShift.current = 0;
    setWakeStatus("idle");
    setRerouteStatus("idle");
    if (final) setSnapshot(final);
    opts.current.onFrame(null);
    opts.current.onLineChange?.(null);
    opts.current.onEnded();
  }, [stopSources]);

  /** Must be called from a tap: speech and the wake lock both need a user gesture on iOS. */
  const begin = useCallback((kind: "gps" | "sim") => {
    stopSources();
    const { line, routeKm, events, slowZonesKm, lang } = opts.current;
    source.current = kind;
    kmShift.current = 0;
    reroute.current = { busy: false, lastAt: 0, controller: null };
    setRerouteStatus("idle");
    opts.current.onLineChange?.(null);
    const cruise = makeEngine(line, routeKm, events);
    engine.current = cruise;
    arrivedSent.current = false;
    setGpsError(false);
    setGpsLost(false);

    voice.current = voice.current ?? createVoice();
    voice.current.setMuted(controls.current.muted);
    setVoiceInfo(voice.current.init(lang));
    wake.current = wake.current ?? createWakeLock();
    void wake.current.request().then(setWakeStatus);

    if (kind === "sim") {
      const sim = createSimulator(line, routeKm, { slowZonesKm });
      simulator.current = sim;
      clockBase.current = Date.now();
      let previousPose: DrivePose | undefined;
      publish(cruise.snapshot());
      timer.current = window.setInterval(() => {
        if (!engine.current) return;
        const burst = sim.tick(Math.round((SIM_SPEEDUP * SIM_TICK_MS) / 1000));
        let last = engine.current.snapshot();
        const poses: DrivePose[] = previousPose ? [previousPose] : [];
        const reached: CruiseSnapshot["reached"] = [];
        let speak: CruiseSnapshot["speak"] = null;
        let turnCue: CruiseSnapshot["turnCue"] = null;
        for (const fix of burst) {
          // Read the ref each time: a reroute can swap the engine in the middle of a burst.
          const current = engine.current;
          if (!current) break;
          last = current.push({ ...fix, t: fix.t + clockBase.current }, controls.current);
          // Draw the simulated path itself so changing the route-match state cannot teleport the car.
          previousPose = { point: [fix.lng, fix.lat], course: fix.heading, speedKmh: last.speedKmh };
          poses.push(previousPose);
          reached.push(...last.reached);
          // Fast-forwarding produces many lines at once; keep the most urgent.
          if (last.speak && (!speak || last.speak.level > speak.level)) speak = last.speak;
          turnCue = moreUrgent(turnCue, last.turnCue);
        }
        if (burst.length) {
          // Play the fixes over the next tick while the HUD keeps its existing update cadence.
          publish({ ...last, reached, speak, turnCue }, { startedAt: performance.now(), sampleMs: 1000 / SIM_SPEEDUP, poses });
        }
        if (sim.done() && last.arrived && timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
      }, SIM_TICK_MS);
      return;
    }

    publish(cruise.snapshot());
    if (!navigator.geolocation) { setGpsError(true); exit(); return; }
    watch.current = navigator.geolocation.watchPosition(({ coords, timestamp }) => {
      const fix: Fix = {
        t: timestamp, lat: coords.latitude, lng: coords.longitude,
        speed: coords.speed, heading: coords.heading !== null && Number.isFinite(coords.heading) ? coords.heading : null,
        accuracy: coords.accuracy,
      };
      setGpsLost(false);
      const next = engine.current?.push(fix, controls.current);
      if (next) publish(next);
    }, (error) => {
      // Only a refusal ends the drive. A timeout or a lost signal is normal in a car, so say so and keep listening.
      if (error.code === 1) { setGpsError(true); exit(); } else setGpsLost(true);
    }, { enableHighAccuracy: true, maximumAge: 2000 });
  }, [exit, makeEngine, publish, stopSources]);

  useEffect(() => () => {
    stopSources();
    reroute.current.controller?.abort();
    voice.current?.cancel();
    void wake.current?.release();
  }, [stopSources]);

  return {
    snapshot, muted, voiceLevel, headingUp, wakeStatus, voiceInfo, gpsError, gpsLost, rerouteStatus,
    startGps: () => begin("gps"),
    startSim: () => begin("sim"),
    exit,
    injectDetour: () => simulator.current?.injectDetour({ lengthKm: 1.5, offsetM: 400 }),
    setHeadingUp,
    setMuted(value: boolean) { controls.current.muted = value; voice.current?.setMuted(value); setMutedState(value); },
    setVoiceLevel(value: VoiceLevel) { controls.current.voice = value; setVoiceLevelState(value); },
  };
}
