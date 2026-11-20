import type { StyleSpecification } from "maplibre-gl";

/** Base-map colours, read from the `--map-*` tokens in app/tokens.css. */
export type MapPalette = {
  land: string; green: string; water: string; building: string;
  road: string; roadMajor: string; roadCasing: string; rail: string;
};

export const mapPaletteTokens: Record<keyof MapPalette, string> = {
  land: "--map-day-land", green: "--map-day-green", water: "--map-day-water", building: "--map-day-building",
  road: "--map-day-road", roadMajor: "--map-day-road-major", roadCasing: "--map-day-road-casing", rail: "--map-day-rail",
};

type Rule = { test: RegExp; key: string; colour: keyof MapPalette };

// First match wins, so specific rules come before general ones.
const rules: Rule[] = [
  { test: /^background$/, key: "background-color", colour: "land" },
  { test: /^(park|landcover_(wood|grass)|landuse_(pitch|track|cemetery))$/, key: "fill-color", colour: "green" },
  { test: /^park_outline$/, key: "line-color", colour: "green" },
  { test: /^water$/, key: "fill-color", colour: "water" },
  { test: /^waterway_/, key: "line-color", colour: "water" },
  { test: /^building-3d$/, key: "fill-extrusion-color", colour: "building" },
  { test: /^building$/, key: "fill-color", colour: "building" },
  { test: /_casing$/, key: "line-color", colour: "roadCasing" },
  { test: /_(major|transit)_rail(_hatching)?$/, key: "line-color", colour: "rail" },
  { test: /_(motorway|motorway_link|trunk_primary)$/, key: "line-color", colour: "roadMajor" },
  { test: /^(road|bridge|tunnel)_/, key: "line-color", colour: "road" },
];

/** Recolours the OpenFreeMap "liberty" vector style to the app palette. Unknown layers keep their colours. */
export function applyMapTheme(style: StyleSpecification, palette: MapPalette): StyleSpecification {
  for (const layer of style.layers) {
    // A paint key such as "line-color" only applies to layers of type "line" (labels share road_ ids).
    const rule = rules.find(({ test, key }) => test.test(layer.id) && key === `${layer.type}-color`);
    if (!rule || !palette[rule.colour]) continue;
    const paint = ((layer as { paint?: Record<string, unknown> }).paint ??= {});
    paint[rule.key] = palette[rule.colour];
  }
  return style;
}
