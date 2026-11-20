import { describe, expect, it } from "vitest";
import { getRoute } from "@/lib/data";
import { cleanPlate, DEFAULT_GARAGE, frameUrl, parseGarage, spriteUrl } from "@/lib/garage";
import { completeQuest, EMPTY_PROGRESS, levelOf, parseProgress, startQuest, titleOf, xpForLevel } from "@/lib/progress";
import { onRoute, placeQuests, QUESTS, questReached, surauQuests } from "@/lib/quests";

const { line, rnr } = getRoute("kl-ipoh");
const placed = placeQuests(line, [...QUESTS, ...surauQuests(rnr.items)]);

describe("side quests on the KL → Ipoh route", () => {
  it("makes a prayer quest for each stop with a confirmed surau", () => {
    const surau = surauQuests(rnr.items);
    expect(surau.length).toBe(rnr.items.filter((stop) => stop.facilities.surau === true).length);
    expect(surau[0].category).toBe("prayer");
  });

  it("places every curated quest near the route, in route order", () => {
    expect(onRoute(placed)).toHaveLength(placed.length);
    for (let i = 1; i < placed.length; i++) expect(placed[i].km).toBeGreaterThanOrEqual(placed[i - 1].km);
  });

  it("puts a rest-stop quest on the way and charges a detour for places off the road", () => {
    const surau = placed.find((quest) => quest.category === "prayer")!;
    expect(surau.detourKm).toBe(0);
    const castle = placed.find((quest) => quest.id === "kellies-castle")!;
    expect(castle.detourKm).toBeGreaterThan(1);
    expect(castle.extraMin).toBeGreaterThan(0);
  });

  it("counts a quest reached by GPS within 300 m, or by passing it in a simulation", () => {
    const quest = placed[0];
    expect(questReached(quest, { km: null, point: [quest.lng + 0.001, quest.lat], simulated: false })).toBe(true);
    expect(questReached(quest, { km: null, point: [quest.lng + 0.05, quest.lat], simulated: false })).toBe(false);
    expect(questReached(quest, { km: quest.km - 1, point: null, simulated: true })).toBe(false);
    expect(questReached(quest, { km: quest.km + 0.1, point: null, simulated: true })).toBe(true);
  });
});

describe("XP and levels", () => {
  it("asks 100 more XP for each level", () => {
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([0, 100, 300, 600]);
    expect(levelOf(0)).toMatchObject({ level: 1, toNext: 100 });
    expect(levelOf(350)).toMatchObject({ level: 3, intoLevel: 50, levelSize: 300, toNext: 250 });
    expect(titleOf(12).en).toBe("Road warrior");
  });

  it("pays a quest once, clears it as active and reports a level up", () => {
    const started = startQuest(EMPTY_PROGRESS, "q");
    const first = completeQuest(started, "q", 150);
    expect(first).toMatchObject({ gained: 150, levelsUp: 1, progress: { xp: 150, completed: ["q"], active: null } });
    expect(completeQuest(first.progress, "q", 150).gained).toBe(0);
  });

  it("survives broken storage", () => {
    expect(parseProgress("not json")).toEqual(EMPTY_PROGRESS);
    expect(parseProgress(JSON.stringify({ xp: -5, completed: ["a", 3], active: 7 }))).toEqual({ xp: 0, completed: ["a"], active: null });
  });
});

describe("garage", () => {
  it("builds sprite and turntable paths that wrap around", () => {
    expect(spriteUrl({ vehicle: "kart", paint: "sage" })).toBe("/garage/kart-sage-top.webp");
    expect(frameUrl({ vehicle: "hatchback", paint: "plum" }, 13)).toBe("/garage/hatchback-plum-01.webp");
    expect(frameUrl({ vehicle: "kart", paint: "coral" }, -1)).toBe("/garage/kart-coral-11.webp");
  });

  it("cleans number plates and falls back field by field", () => {
    expect(cleanPlate("wxy 1234-abc")).toBe("WXY 1234AB");
    expect(parseGarage(JSON.stringify({ vehicle: "tank", paint: "sunny", plate: "  " }))).toEqual({ ...DEFAULT_GARAGE, paint: "sunny" });
    expect(parseGarage(null)).toEqual(DEFAULT_GARAGE);
  });
});
