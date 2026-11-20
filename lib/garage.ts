/**
 * The Garage: which vehicle and paint the driver sees on the map. Sprites are rendered in Blender by
 * design/blender/build_garage.py; the ids here must match its MODELS and PAINTS.
 */
export const VEHICLES = [
  { id: "kart", name: { en: "Kampung kart", bm: "Kart kampung" }, blurb: { en: "Big wheels, googly eyes, durians on board", bm: "Roda besar, mata bulat, durian di belakang" } },
  { id: "hatchback", name: { en: "Hatchback", bm: "Hatchback" }, blurb: { en: "The sensible balik kampung classic", bm: "Kereta klasik balik kampung" } },
] as const;

export const PAINTS = [
  { id: "coral", hex: "#d9725f", name: { en: "Coral", bm: "Koral" } },
  { id: "plum", hex: "#4a3f6b", name: { en: "Plum", bm: "Ungu plum" } },
  { id: "sage", hex: "#6fa592", name: { en: "Sage", bm: "Hijau sage" } },
  { id: "lavender", hex: "#9d8fd6", name: { en: "Lavender", bm: "Lavender" } },
  { id: "sunny", hex: "#f2b84b", name: { en: "Sunny", bm: "Kuning cerah" } },
] as const;

export type VehicleId = (typeof VEHICLES)[number]["id"];
export type PaintId = (typeof PAINTS)[number]["id"];
export type GarageChoice = { vehicle: VehicleId; paint: PaintId; plate: string };

/** Turntable frames per vehicle and paint, 30° apart. */
export const FRAMES = 12;
/** Level that unlocks the roof box (shown locked until then). */
export const ROOF_BOX_LEVEL = 15;
export const DEFAULT_GARAGE: GarageChoice = { vehicle: "kart", paint: "coral", plate: "BKK 2026" };

const KEY = "lapan-garage";
const isVehicle = (value: unknown): value is VehicleId => VEHICLES.some((v) => v.id === value);
const isPaint = (value: unknown): value is PaintId => PAINTS.some((p) => p.id === value);

export const spriteUrl = (choice: Pick<GarageChoice, "vehicle" | "paint">) => `/garage/${choice.vehicle}-${choice.paint}-top.webp`;
export const frameUrl = (choice: Pick<GarageChoice, "vehicle" | "paint">, frame: number) =>
  `/garage/${choice.vehicle}-${choice.paint}-${String(((frame % FRAMES) + FRAMES) % FRAMES).padStart(2, "0")}.webp`;

/** Number plates: letters, digits and spaces, upper case, at most 10 characters. */
export function cleanPlate(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trimStart().slice(0, 10);
}

/** Reads a stored choice, falling back field by field to the default. */
export function parseGarage(raw: string | null): GarageChoice {
  try {
    const data = raw ? JSON.parse(raw) : {};
    return {
      vehicle: isVehicle(data.vehicle) ? data.vehicle : DEFAULT_GARAGE.vehicle,
      paint: isPaint(data.paint) ? data.paint : DEFAULT_GARAGE.paint,
      plate: typeof data.plate === "string" && cleanPlate(data.plate).trim() ? cleanPlate(data.plate).trim() : DEFAULT_GARAGE.plate,
    };
  } catch {
    return DEFAULT_GARAGE;
  }
}

export function loadGarage(): GarageChoice {
  try { return parseGarage(localStorage.getItem(KEY)); } catch { return DEFAULT_GARAGE; }
}

export function saveGarage(choice: GarageChoice) {
  try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* storage blocked: the choice lasts this visit */ }
}
