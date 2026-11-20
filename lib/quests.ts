import { haversineKm, makeProjector } from "./enrich";
import type { Lang } from "./i18n";
import type { RouteLine } from "./route";
import type { Stop } from "./schemas";

export type QuestCategory = "food" | "nature" | "culture" | "prayer";
type Text = Record<Lang, string>;

export type Quest = {
  id: string; category: QuestCategory; title: Text; blurb: Text; place: Text;
  lat: number; lng: number;
  /** Coordinates are approximate (a town centre or landmark): the app says so and links to a map search. */
  approximate: boolean;
  xp: number; stayMin: number; objectives: Text[];
};

/** Where a quest sits relative to a route. `km` is the closest point along the route; detour figures are estimates. */
export type PlacedQuest = Quest & { km: number; offKm: number; detourKm: number; extraMin: number };

/** Quests further than this from the route are not "on my route". */
export const ON_ROUTE_KM = 20;
/** A visit counts within this distance of the quest location (GPS). */
export const ARRIVE_KM = 0.3;
/** Roads are longer than a straight line; this turns crow-flies into a rough road distance. */
const ROAD_FACTOR = 1.35;
const DETOUR_KMH = 45;

/** Curated side quests along the KL → Ipoh corridor. Places are real; the app does not claim opening hours or menus. */
export const QUESTS: Quest[] = [
  {
    id: "ipoh-old-town-nasi-kandar", category: "food",
    title: { en: "Nasi kandar in Ipoh old town", bm: "Nasi kandar di bandar lama Ipoh" },
    blurb: { en: "Find a nasi kandar spot in the old town and take a proper break.", bm: "Cari kedai nasi kandar di bandar lama dan berehat sebentar." },
    place: { en: "Ipoh old town", bm: "Bandar lama Ipoh" },
    lat: 4.5966, lng: 101.0789, approximate: true, xp: 150, stayMin: 15,
    objectives: [
      { en: "Drive to Ipoh old town", bm: "Pandu ke bandar lama Ipoh" },
      { en: "Stop for at least 15 minutes", bm: "Berhenti sekurang-kurangnya 15 minit" },
      { en: "Rate your meal", bm: "Nilai hidangan anda" },
    ],
  },
  {
    id: "gua-tempurung", category: "nature",
    title: { en: "Peek into Gua Tempurung", bm: "Jenguk Gua Tempurung" },
    blurb: { en: "A limestone cave right beside the expressway near Gopeng.", bm: "Gua batu kapur di tepi lebuh raya berhampiran Gopeng." },
    place: { en: "Gua Tempurung, Gopeng", bm: "Gua Tempurung, Gopeng" },
    lat: 4.4153, lng: 101.1879, approximate: true, xp: 200, stayMin: 30,
    objectives: [
      { en: "Drive to Gua Tempurung", bm: "Pandu ke Gua Tempurung" },
      { en: "Check today's opening hours at the entrance", bm: "Semak waktu dibuka di pintu masuk" },
      { en: "Take a photo at the cave mouth", bm: "Ambil gambar di mulut gua" },
    ],
  },
  {
    id: "kellies-castle", category: "culture",
    title: { en: "The unfinished castle", bm: "Istana yang tidak siap" },
    blurb: { en: "Kellie's Castle near Batu Gajah, a short hop off the highway.", bm: "Kellie's Castle berhampiran Batu Gajah, tidak jauh dari lebuh raya." },
    place: { en: "Kellie's Castle, Batu Gajah", bm: "Kellie's Castle, Batu Gajah" },
    lat: 4.4745, lng: 101.0877, approximate: true, xp: 180, stayMin: 30,
    objectives: [
      { en: "Drive to Kellie's Castle", bm: "Pandu ke Kellie's Castle" },
      { en: "Walk around the grounds", bm: "Jalan-jalan di kawasan istana" },
      { en: "Spot the unfinished tower", bm: "Cari menara yang tidak siap" },
    ],
  },
];

/** "Pray at a surau": one quest per curated rest stop with a confirmed surau. */
export function surauQuests(stops: Stop[]): Quest[] {
  return stops.filter((stop) => stop.facilities.surau === true).map((stop) => ({
    id: `surau-${stop.id}`, category: "prayer",
    title: { en: `Pray at ${stop.name}`, bm: `Solat di ${stop.name}` },
    blurb: { en: "A rest stop with a confirmed surau, right on your route.", bm: "Kawasan rehat dengan surau yang disahkan, terus di laluan anda." },
    place: { en: stop.name, bm: stop.name },
    lat: stop.lat, lng: stop.lng, approximate: false, xp: 100, stayMin: 15,
    objectives: [
      { en: `Stop at ${stop.name}`, bm: `Berhenti di ${stop.name}` },
      { en: "Pray and stretch your legs", bm: "Solat dan regangkan kaki" },
    ],
  }));
}

/** Places quests on a route: closest point, how far off it is, and a rough detour (there and back by road). */
export function placeQuests(line: RouteLine, quests: Quest[]): PlacedQuest[] {
  const { project } = makeProjector(line);
  return quests.map((quest) => {
    const spot = project(quest.lng, quest.lat);
    const offKm = spot.offM / 1000;
    const detourKm = offKm < 0.2 ? 0 : Math.round(offKm * 2 * ROAD_FACTOR * 10) / 10;
    return { ...quest, km: spot.km, offKm, detourKm, extraMin: Math.round((detourKm / DETOUR_KMH) * 60) };
  }).sort((a, b) => a.km - b.km);
}

export const onRoute = (quests: PlacedQuest[]) => quests.filter((quest) => quest.offKm <= ON_ROUTE_KM);

/** A quest is reached at its location (GPS), or, in a simulated drive that never leaves the road, at its closest point. */
export function questReached(quest: PlacedQuest, at: { km: number | null; point: [number, number] | null; simulated: boolean }): boolean {
  if (at.simulated) return at.km !== null && at.km >= quest.km;
  return at.point !== null && haversineKm(at.point, [quest.lng, quest.lat]) <= ARRIVE_KM;
}

export function mapsSearchUrl(quest: Quest, lang: Lang) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(quest.place[lang])}`;
}
