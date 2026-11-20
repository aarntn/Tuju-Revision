import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { applyMapTheme, type MapPalette } from "@/lib/map-theme";

const palette: MapPalette = {
  land: "#land", green: "#green", water: "#water", building: "#building",
  road: "#road", roadMajor: "#major", roadCasing: "#casing", rail: "#rail",
};

function style(layers: { id: string; type: string; paint?: Record<string, unknown> }[]) {
  return { version: 8, sources: {}, layers } as unknown as StyleSpecification;
}
const paintOf = (s: StyleSpecification, id: string) => (s.layers.find((l) => l.id === id) as { paint?: Record<string, unknown> }).paint;

describe("applyMapTheme", () => {
  it("recolours land, water, parks and buildings", () => {
    const s = applyMapTheme(style([
      { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
      { id: "water", type: "fill", paint: { "fill-color": "blue" } },
      { id: "waterway_river", type: "line", paint: { "line-color": "blue" } },
      { id: "park", type: "fill", paint: { "fill-color": "green" } },
      { id: "building-3d", type: "fill-extrusion", paint: { "fill-extrusion-color": "grey" } },
    ]), palette);
    expect(paintOf(s, "background")?.["background-color"]).toBe("#land");
    expect(paintOf(s, "water")?.["fill-color"]).toBe("#water");
    expect(paintOf(s, "waterway_river")?.["line-color"]).toBe("#water");
    expect(paintOf(s, "park")?.["fill-color"]).toBe("#green");
    expect(paintOf(s, "building-3d")?.["fill-extrusion-color"]).toBe("#building");
  });

  it("separates casings, major roads, minor roads and rail", () => {
    const s = applyMapTheme(style([
      { id: "road_motorway_casing", type: "line", paint: { "line-color": "#e9ac77" } },
      { id: "road_motorway", type: "line", paint: { "line-color": ["interpolate", ["linear"], ["zoom"], 5, "red", 6, "#fc8"] } },
      { id: "bridge_trunk_primary", type: "line", paint: { "line-color": "#fea" } },
      { id: "road_minor", type: "line", paint: { "line-color": "#fff" } },
      { id: "road_major_rail_hatching", type: "line", paint: { "line-color": "#bbb" } },
    ]), palette);
    expect(paintOf(s, "road_motorway_casing")?.["line-color"]).toBe("#casing");
    expect(paintOf(s, "road_motorway")?.["line-color"]).toBe("#major");
    expect(paintOf(s, "bridge_trunk_primary")?.["line-color"]).toBe("#major");
    expect(paintOf(s, "road_minor")?.["line-color"]).toBe("#road");
    expect(paintOf(s, "road_major_rail_hatching")?.["line-color"]).toBe("#rail");
  });

  it("never gives a symbol layer a line colour", () => {
    const s = applyMapTheme(style([
      { id: "road_oneway", type: "symbol", paint: { "icon-opacity": 0.5 } },
      { id: "road_motorway_link", type: "line", paint: { "line-color": "#fc8" } },
    ]), palette);
    expect(paintOf(s, "road_oneway")).toEqual({ "icon-opacity": 0.5 });
    expect(paintOf(s, "road_motorway_link")?.["line-color"]).toBe("#major");
  });

  it("leaves unknown layers and empty palette entries alone", () => {
    const s = applyMapTheme(style([
      { id: "boundary_2", type: "line", paint: { "line-color": "#666" } },
      { id: "water", type: "fill", paint: { "fill-color": "blue" } },
    ]), { ...palette, water: "" });
    expect(paintOf(s, "boundary_2")?.["line-color"]).toBe("#666");
    expect(paintOf(s, "water")?.["fill-color"]).toBe("blue");
  });
});
