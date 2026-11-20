import { describe, expect, it } from "vitest";
import { getRoute } from "@/lib/data";
import {
  buildManeuvers, createTurnCaller, cueDistances, cuePhrase, instruction, nextTurn, spokenDistance, stepsOf, turnIcon,
  type Maneuver,
} from "@/lib/directions";
import { createCruise } from "@/lib/cruise/engine";
import { createSimulator } from "@/lib/cruise/simulator";
import { routeLengthKm, type RouteLine } from "@/lib/route";
import { compactSteps } from "@/lib/routing";
import { rerouteLine, shiftEvents } from "@/lib/reroute";

const { line } = getRoute("kl-ipoh");
const totalKm = routeLengthKm(line);
const maneuvers = buildManeuvers(line);

const m = (patch: Partial<Maneuver>): Maneuver => ({ id: "x", km: 1, type: "turn", road: "", lng: 0, lat: 0, ...patch });

describe("compactSteps", () => {
  it("keeps the manoeuvre and adds up the distance before it", () => {
    const steps = compactSteps([{ steps: [
      { distance: 120, name: "Jalan A", maneuver: { type: "depart", location: [101, 3] } },
      { distance: 300, name: "", ref: "E1", maneuver: { type: "turn", modifier: "left", location: [101.1, 3.1] } },
      { distance: 0, name: "Bulatan", rotary_name: "Bulatan Besar", maneuver: { type: "rotary", exit: 2, location: [101.2, 3.2] } },
    ] }]);
    expect(steps.map((s) => s.along_m)).toEqual([0, 120, 420]);
    expect(steps[1]).toMatchObject({ type: "turn", modifier: "left", ref: "E1", lng: 101.1, lat: 3.1 });
    expect(steps[2]).toMatchObject({ name: "Bulatan Besar", exit: 2 });
  });
});

describe("buildManeuvers on the KL → Ipoh route", () => {
  it("ships turn steps with the curated line", () => {
    expect(stepsOf(line).length).toBeGreaterThan(10);
  });

  it("places manoeuvres in order along the line, dropping the silent ones", () => {
    expect(maneuvers.length).toBeGreaterThan(8);
    for (let i = 1; i < maneuvers.length; i++) expect(maneuvers[i].km).toBeGreaterThanOrEqual(maneuvers[i - 1].km);
    expect(maneuvers.some((x) => x.type === "depart" || x.type === "new name")).toBe(false);
  });

  it("finds the merge onto the North–South Expressway near km 12 and the exit near km 181", () => {
    const merge = maneuvers.find((x) => x.road.includes("Utara–Selatan"));
    expect(merge?.km).toBeGreaterThan(11);
    expect(merge?.km).toBeLessThan(14);
    const exit = maneuvers.find((x) => x.type === "off ramp" && x.km > 150);
    expect(exit?.km).toBeGreaterThan(178);
    expect(exit?.km).toBeLessThan(184);
  });

  it("ends with the arrival at the end of the line", () => {
    const last = maneuvers.at(-1)!;
    expect(last.type).toBe("arrive");
    expect(last.km).toBeCloseTo(totalKm, 3);
  });

  it("returns nothing for a line without steps", () => {
    expect(buildManeuvers({ ...line, properties: {} } as RouteLine)).toEqual([]);
  });
});

describe("instructions", () => {
  it("words turns, exits, forks and roundabouts in English and Malay", () => {
    expect(instruction("en", m({ modifier: "right", road: "Jalan Duta" }))).toBe("Turn right onto Jalan Duta");
    expect(instruction("bm", m({ modifier: "right", road: "Jalan Duta" }))).toBe("Belok kanan ke Jalan Duta");
    expect(instruction("en", m({ type: "off ramp", modifier: "slight left" }))).toBe("Take the exit on the left");
    expect(instruction("en", m({ type: "fork", modifier: "slight right", road: "E1" }))).toBe("Keep right onto E1");
    expect(instruction("en", m({ type: "roundabout", exit: 2, road: "Jalan Raja Dihilir" })))
      .toBe("At the roundabout, take the 2nd exit onto Jalan Raja Dihilir");
    expect(instruction("bm", m({ type: "roundabout", exit: 3 }))).toBe("Di bulatan, ambil susur keluar ke-3");
    expect(instruction("en", m({ type: "arrive" }), "Ipoh")).toBe("Arrive at Ipoh");
  });

  it("picks an arrow for each manoeuvre", () => {
    expect(turnIcon(m({ modifier: "sharp left" }))).toBe("sharp-left");
    expect(turnIcon(m({ type: "rotary" }))).toBe("roundabout");
    expect(turnIcon(m({ type: "arrive" }))).toBe("arrive");
    expect(turnIcon(m({ type: "merge" }))).toBe("straight");
  });

  it("says distances the way people do", () => {
    expect(spokenDistance("en", 0.31)).toBe("300 m");
    expect(spokenDistance("en", 1.7)).toBe("1.5 km");
    expect(spokenDistance("en", 12.4)).toBe("12 km");
  });

  it("builds spoken cues with a lead-in and a chained turn", () => {
    const turn = m({ modifier: "right", road: "Jalan A" });
    const then = m({ type: "fork", modifier: "slight left" });
    expect(cuePhrase("en", { maneuver: turn, then: null, stage: "far", distKm: 2 })).toBe("In 2 km, turn right onto Jalan A");
    expect(cuePhrase("en", { maneuver: turn, then, stage: "near", distKm: 0.3 })).toBe("In 300 m, turn right onto Jalan A, then keep left");
    expect(cuePhrase("bm", { maneuver: turn, then: null, stage: "now", distKm: 0.05 })).toBe("Belok kanan ke Jalan A");
  });
});

describe("nextTurn and the turn caller", () => {
  const list = [m({ id: "a", km: 1 }), m({ id: "b", km: 1.1, modifier: "left" }), m({ id: "c", km: 5 })];

  it("reports the next manoeuvre, chaining one that follows closely", () => {
    expect(nextTurn(list, 0.5)).toMatchObject({ maneuver: { id: "a" }, then: { id: "b" } });
    expect(nextTurn(list, 0.5)?.distKm).toBeCloseTo(0.5);
    expect(nextTurn(list, 1.05)?.maneuver.id).toBe("b");
    expect(nextTurn(list, 6)).toBeNull();
  });

  it("does not chain a repeat of the same instruction", () => {
    const forks = [m({ id: "a", km: 1, type: "fork", modifier: "slight right", road: "E33" }), m({ id: "b", km: 1.1, type: "fork", modifier: "slight right", road: "E33" })];
    expect(nextTurn(forks, 0.5)?.then).toBeNull();
  });

  it("speaks far, near and now once each, earlier on the highway", () => {
    expect(cueDistances(30).far).toBeGreaterThan(cueDistances(10).far);
    const caller = createTurnCaller([m({ id: "t", km: 10, modifier: "right" })]);
    const speed = 30; // 108 km/h
    const stages = [5, 8.1, 8.2, 9.6, 9.7, 9.86, 9.9].map((km) => caller.update(km, speed).cue?.stage ?? null);
    expect(stages).toEqual([null, "far", null, "near", null, "now", null]);
  });

  it("skips straight to the latest stage when a turn comes up suddenly", () => {
    const caller = createTurnCaller([m({ id: "t", km: 0.1 })]);
    expect(caller.update(0, 10).cue?.stage).toBe("near");
  });
});

describe("the cruise engine with directions", () => {
  it("reports the next turn and speaks every manoeuvre on a simulated drive", () => {
    const cruise = createCruise({ line, routeKm: totalKm, events: [], maneuvers });
    cruise.simulate();
    const sim = createSimulator(line, totalKm);
    const spoken = new Set<string>();
    let sawTurn = false;
    while (!sim.done()) {
      for (const fix of sim.tick(60)) {
        const snap = cruise.push(fix, { voice: "normal", muted: false });
        if (snap.turn) sawTurn = true;
        if (snap.turnCue) spoken.add(snap.turnCue.maneuver.id);
        // A turn right after another is said with it ("…, then turn right").
        if (snap.turnCue?.then && snap.turnCue.stage !== "far") spoken.add(snap.turnCue.then.id);
      }
    }
    expect(sawTurn).toBe(true);
    // Every manoeuvre after the engine locks on gets at least one cue.
    const reachable = maneuvers.filter((x) => x.km > 1);
    for (const x of reachable) expect(spoken.has(x.id), `${x.type} at ${x.km.toFixed(1)} km`).toBe(true);
  }, 30_000); // drives all 192 km fix by fix
});

describe("rerouting helpers", () => {
  it("turns a route option into a line that keeps its steps", () => {
    const rerouted = rerouteLine({ id: "r0", distance_m: 1000, duration_s: 60, geometry: { type: "LineString", coordinates: [[101, 3], [101.01, 3]] },
      steps: [{ type: "arrive", name: "", lng: 101.01, lat: 3, along_m: 1000 }] }, "OSRM", "2026-11-20T00:00:00Z");
    expect(stepsOf(rerouted)).toHaveLength(1);
    expect(rerouted.properties?.distance_m).toBe(1000);
  });

  it("keeps each event's distance to the destination and drops ones already behind", () => {
    const events = [10, 50, 150].map((km) => ({ id: String(km), kind: "rnr" as const, name: "", km, planned: false, relevant: true, facilities: [] }));
    const moved = shiftEvents(events, 200, 160);
    expect(moved.map((e) => e.km)).toEqual([10, 110]);
  });
});
