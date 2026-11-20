"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapInstance, Marker as MapMarker, StyleSpecification } from "maplibre-gl";
import { bearingBetween, driveCamera, interpolateDrivePose, type DriveFrame, type DrivePoint, type DrivePose } from "@/lib/drive-camera";
import { pointAt, routeLengthKm, sliceAhead, type RouteLine } from "@/lib/route";
import { zoomForSpeed } from "@/lib/cruise/zoom";
import type { Stop } from "@/lib/schemas";
import { t, type Lang } from "@/lib/i18n";
import { MAP_TOKEN_NAMES, PIN_LEGEND, patchNightOps, pinGlyph, stopPin, type MapTokens } from "@/lib/night-ops";
import type { GarageCar } from "@/lib/road-game";
import { applyMapTheme, mapPaletteTokens, type MapPalette } from "@/lib/map-theme";
import { loadGarage, spriteUrl } from "@/lib/garage";

/** A side quest drawn on the map. */
export type QuestPin = { id: string; lng: number; lat: number; title: string; active: boolean; done: boolean };

const libertyUrl = "https://tiles.openfreemap.org/styles/liberty";
const defaultTileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
type Point = DrivePoint;

function rasterStyle(tiles: string): StyleSpecification {
  return {
    version: 8,
    sources: { street: { type: "raster", tiles: [tiles], tileSize: 256 } },
    layers: [{ id: "street", type: "raster", source: "street", paint: { "raster-saturation": -0.35 } }],
  };
}

async function streetStyle(): Promise<{ style: StyleSpecification; vector: boolean }> {
  const raster = process.env.NEXT_PUBLIC_TILE_URL;
  if (raster) return { style: rasterStyle(raster), vector: false };
  try {
    const response = await fetch(libertyUrl, { signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error("Street style unavailable");
    const style: StyleSpecification = await response.json();
    style.layers = style.layers.filter(({ id }) => !id.startsWith("poi_"));
    return { style, vector: true };
  } catch {
    return { style: rasterStyle(defaultTileUrl), vector: false };
  }
}

function diamond(category: string, icon: Parameters<typeof pinGlyph>[0], unverified: boolean, dim: boolean): HTMLElement {
  const shape = document.createElement("span");
  shape.className = "pin-diamond";
  shape.dataset.category = category;
  shape.dataset.unverified = String(unverified);
  shape.dataset.dim = String(dim);
  const glyph = document.createElement("span");
  glyph.className = "pin-icon";
  glyph.innerHTML = pinGlyph(icon);
  shape.append(glyph);
  return shape;
}

function mapTokens(token: (name: string) => string): MapTokens {
  return Object.fromEntries(MAP_TOKEN_NAMES.map((name) => [name, token(name)])) as MapTokens;
}

/** The route, its lit ribbon and chevrons. Re-run after every style swap, because a new style drops custom layers. */
function installOverlay(map: MapInstance, line: RouteLine, token: (name: string) => string) {
  map.addSource("jalan-pulang-corridor", { type: "geojson", data: line, lineMetrics: true });
  const insertBefore = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  map.addSource("jalan-pulang-alternatives", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "jalan-pulang-alternatives", type: "line", source: "jalan-pulang-alternatives",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": token("--color-route-alt"), "line-width": 5, "line-opacity": 0.8 },
  }, insertBefore);
  for (const [id, color, width] of [
    ["jalan-pulang-halo", token("--map-route-halo"), Number(token("--map-route-halo-width")) || 13],
    ["jalan-pulang-route", token("--color-route"), Number(token("--map-route-core-width")) || 8],
    ["jalan-pulang-route-shine", token("--map-route-shine"), 2],
  ] as const) {
    map.addLayer({
      id, source: "jalan-pulang-corridor", type: "line",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 7, width * 0.65, 14, width],
        ...(id === "jalan-pulang-halo" ? { "line-blur": Number(token("--map-route-halo-blur")) || 0 } : {}),
      },
    }, insertBefore);
  }
  // A lit ribbon with chevrons on the road ahead of the car, like Amap's cruise view. Hidden until a drive starts.
  map.addSource("jalan-pulang-ahead", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const chevron = document.createElement("canvas");
  chevron.width = chevron.height = 32;
  const ink = chevron.getContext("2d");
  if (ink) {
    ink.strokeStyle = "#ffffff"; ink.lineWidth = 5; ink.lineCap = "round"; ink.lineJoin = "round";
    ink.beginPath(); ink.moveTo(11, 7); ink.lineTo(21, 16); ink.lineTo(11, 25); ink.stroke();
    map.addImage("route-chevron", ink.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
  }
  map.addLayer({
    id: "jalan-pulang-ribbon", source: "jalan-pulang-ahead", type: "line",
    layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
    paint: { "line-color": token("--map-route-shine"), "line-width": ["interpolate", ["linear"], ["zoom"], 12, 12, 17, 44], "line-opacity": 0.5, "line-blur": 3 },
  }, "jalan-pulang-halo");
  map.addLayer({
    id: "jalan-pulang-chevrons", source: "jalan-pulang-ahead", type: "symbol",
    layout: {
      "symbol-placement": "line", "symbol-spacing": 48, "icon-image": "route-chevron", "icon-size": 0.9,
      "icon-allow-overlap": true, "icon-ignore-placement": true, visibility: "none",
    },
    paint: { "icon-opacity": 0.9 },
  });
}

export function RouteMap({
  line, quests = [], onSelectQuest, stops, driveFrame, simulated, lang, places, online, preview,
  selectedStopId, onSelectStop, focus, padding, driving = false, headingUp = true, browsing,
  startNorthUp, night = false, lite = false, questPins, activeQuestPin, car, showRoute = true,
  alternatives, vehicleSprite: vehicleSpriteProp, plate,
}: {
  line: RouteLine; quests?: QuestPin[]; onSelectQuest?: (id: string) => void; stops: Stop[]; driveFrame: DriveFrame | null; simulated: boolean; lang: Lang;
  places: [string, string]; online: boolean; preview?: string;
  selectedStopId: string | null; onSelectStop?: (id: string | null) => void; driving?: boolean;
  /** While driving: turn the map with the car (true) or keep north at the top (false). */
  headingUp?: boolean;
  browsing: boolean; startNorthUp: boolean;
  /** Night Ops ("Mod Misi") look: patches the basemap, recolours the route, shows diamond pins. */
  night?: boolean; lite?: boolean;
  /** Where to fly when a stop is selected; also covers break points, which have no pin. */
  focus?: { id: string; lat: number; lng: number } | null;
  /** Pixels of the map hidden under floating UI (the sheet, the from/to card). The camera frames the visible part. */
  padding?: { top: number; right: number; bottom: number; left: number };
  questPins?: string[]; activeQuestPin?: string; car?: GarageCar; showRoute?: boolean;
  alternatives?: RouteLine[];
  vehicleSprite?: string; plate?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const outlineVehicle = useRef<SVGImageElement>(null);
  const initialMapHome = useRef(browsing);
  const vehicleMarker = useRef<MapMarker | null>(null);
  const didFollow = useRef(false);
  const routeColors = useRef({ ahead: "", passed: "", shine: "" });
  const pins = useRef(new Map<string, HTMLElement>());
  const onSelect = useRef(onSelectStop);
  onSelect.current = onSelectStop;
  const baseStyle = useRef<StyleSpecification | null>(null);
  const nightNow = useRef(night);
  nightNow.current = night;
  const liteNow = useRef(lite);
  liteNow.current = lite;
  const [styleVersion, setStyleVersion] = useState(0);
  const [map, setMap] = useState<MapInstance | null>(null);
  const [failed, setFailed] = useState(false);
  const [requested, setRequested] = useState(false);
  const [manualLoad, setManualLoad] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [vector, setVector] = useState(false);
  const [planAngled, setPlanAngled] = useState(!startNorthUp);
  const [driveAngled, setDriveAngled] = useState(true);
  const [following, setFollowing] = useState(true);
  const [overview, setOverview] = useState(false);
  const [locateStatus, setLocateStatus] = useState<"idle" | "locating" | "error">("idle");
  const angled = driving ? driveAngled : planAngled;

  const geometry = useMemo(() => {
    const coordinates = line.geometry.coordinates as Point[];
    const start = coordinates[0];
    const end = coordinates.at(-1)!;
    const center = pointAt(line, 0.48);
    const bearing = bearingBetween(start, pointAt(line, 1.3));
    const minX = Math.min(...coordinates.map(([x]) => x));
    const maxX = Math.max(...coordinates.map(([x]) => x));
    const minY = Math.min(...coordinates.map(([, y]) => y));
    const maxY = Math.max(...coordinates.map(([, y]) => y));
    function project([x, y]: Point): Point {
      const distance = (maxY - y) / (maxY - minY || 1);
      const spread = angled ? 112 + distance * 73 : 140;
      return [195 + ((x - minX) / (maxX - minX || 1) - 0.5) * spread, 59 + distance * 218];
    }
    return {
      start, end, center, bearing, project, bounds: [[minX, minY], [maxX, maxY]] as [Point, Point],
      outline: coordinates.filter((_, index) => index % 5 === 0 || index === coordinates.length - 1).map(project).join(" "),
    };
  }, [angled, line]);

  useEffect(() => {
    if (driving && online && !failed) setRequested(true);
    if (!driving) {
      setFollowing(true);
      setDriveAngled(true);
    }
  }, [driving, failed, online]);

  useEffect(() => {
    if (online || map) return;
    setFailed(false);
    setRequested(false);
  }, [map, online]);

  // Load the live map on its own so the first view is never a dead picture. Slow or Save-Data connections keep the tap-to-load preview.
  useEffect(() => {
    if (!online || failed || requested) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || (!browsing && /(^|-)[23]g$/.test(connection?.effectiveType ?? ""))) {
      setManualLoad(true);
      return;
    }
    if (browsing) { setRequested(true); return; }
    const timer = window.setTimeout(() => setRequested(true), 800);
    return () => window.clearTimeout(timer);
  }, [browsing, failed, online, requested]);

  // The car the driver picked in the Garage (read after mount: it lives in this browser's storage).
  const [vehicleSprite, setVehicleSprite] = useState(vehicleSpriteProp ?? "/drive-car.png");
  useEffect(() => { setVehicleSprite(vehicleSpriteProp ?? spriteUrl(loadGarage())); }, [vehicleSpriteProp]);
  const spriteRef = useRef(vehicleSprite);
  spriteRef.current = vehicleSprite;
  const onQuest = useRef(onSelectQuest);
  onQuest.current = onSelectQuest;
  const questMarkers = useRef<MapMarker[]>([]);
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    void import("maplibre-gl").then((libre) => {
      if (cancelled) return;
      questMarkers.current = quests.map((quest) => {
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "map-quest";
        pin.title = quest.title;
        pin.setAttribute("aria-label", quest.title);
        pin.dataset.active = String(quest.active);
        pin.dataset.done = String(quest.done);
        pin.dataset.testid = "map-quest-" + quest.id;
        pin.addEventListener("click", (event) => { event.stopPropagation(); onQuest.current?.(quest.id); });
        return new libre.Marker({ element: pin }).setLngLat([quest.lng, quest.lat]).addTo(map);
      });
    });
    return () => { cancelled = true; questMarkers.current.forEach((marker) => marker.remove()); questMarkers.current = []; };
  }, [map, quests]);
  useEffect(() => {
    const vehicle = vehicleMarker.current?.getElement();
    if (vehicle) vehicle.style.backgroundImage = `url("${vehicleSprite}")`;
  }, [vehicleSprite]);

  const lineRef = useRef(line);
  lineRef.current = line;
  useEffect(() => {
    (map?.getSource("jalan-pulang-corridor") as GeoJSONSource | undefined)?.setData(line);
  }, [line, map]);

  useEffect(() => {
    if (!requested) return;
    // The map is built once per trip. A reroute swaps the line data below instead of rebuilding the map mid-drive.
    const line = lineRef.current;
    let active = true;
    let instance: MapInstance | undefined;
    let loadTimeout: number | undefined;
    void Promise.all([import("maplibre-gl"), streetStyle()]).then(([libre, { style: plain, vector }]) => {
      if (!active || !container.current) return;
      baseStyle.current = plain;
      libre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
      libre.setWorkerCount(1);
      const hasMouse = window.matchMedia("(pointer: fine)").matches;
      const css = getComputedStyle(container.current);
      const token = (name: string) => css.getPropertyValue(name).trim();
      routeColors.current = { ahead: token("--color-route"), passed: token("--map-route-passed"), shine: token("--map-route-shine") };
      let style = nightNow.current ? patchNightOps(plain, mapTokens(token), { bands: liteNow.current ? 1 : undefined }) : plain;
      if (vector) {
        const palette = Object.fromEntries(Object.entries(mapPaletteTokens).map(([key, name]) => [key, token(name)])) as MapPalette;
        applyMapTheme(style, palette);
      }
      instance = new libre.Map({
        container: container.current, style,
        center: line.geometry.coordinates[0] as Point, zoom: startNorthUp ? 12.8 : 14.5,
        attributionControl: false, scrollZoom: hasMouse, cooperativeGestures: !hasMouse, maxPitch: 72,
        ...(initialMapHome.current ? { bounds: geometry.bounds, fitBoundsOptions: { padding: { top: 94, bottom: 306, left: 30, right: 62 } } } : {}),
      });
      const current = instance;
      const basemapSource = vector ? "openmaptiles" : "street";
      let tileReady = false;
      let routeReady = false;
      function showMap() {
        if (!active || !tileReady || !routeReady) return;
        window.clearTimeout(loadTimeout);
        setVector(vector);
        setMap(current);
      }
      const onTile = (event: { sourceId: string; tile: unknown }) => {
        if (event.sourceId !== basemapSource || !event.tile) return;
        tileReady = true;
        current.off("sourcedata", onTile);
        showMap();
      };
      current.on("sourcedata", onTile);
      loadTimeout = window.setTimeout(() => {
        if (!active) return;
        current.remove();
        instance = undefined;
        setFailed(true);
      }, 9000);
      current.once("load", () => {
        if (!active) return;
        installOverlay(current, line, token);
        for (const [stopIndex, stop] of stops.entries()) {
          const pin = document.createElement("button");
          pin.type = "button";
          pin.className = "map-pin";
          pin.dataset.kind = stop.kind;
          pin.title = stop.name;
          pin.setAttribute("aria-label", stop.name);
          pin.dataset.testid = "map-stop-" + stop.id;
          const look = stopPin(stop);
          // Night Ops: a rotated diamond with a white line icon. Hidden in the light theme. More than about 12 glowing pins hurts phones, so the rest are dim.
          pin.append(diamond(look.category, look.icon, look.unverified, stopIndex >= 12));
          pin.addEventListener("click", (event) => { event.stopPropagation(); onSelect.current?.(stop.id); });
          pins.current.set(stop.id, pin);
          new libre.Marker({ element: pin }).setLngLat([stop.lng, stop.lat]).addTo(current);
        }
        for (const [index, point] of [line.geometry.coordinates[0], line.geometry.coordinates.at(-1)!].entries()) {
          const pin = document.createElement("span");
          pin.className = "map-pin map-endpoint";
          pin.dataset.destination = String(index === 1);
          pin.append(diamond(index === 1 ? "orange" : "neutral", index === 1 ? "flag" : "start", false, false));
          new libre.Marker({ element: pin }).setLngLat(point as Point).addTo(current);
        }
        const vehicle = document.createElement("span");
        vehicle.className = "map-vehicle";
        vehicle.dataset.testid = "drive-car";
        vehicle.setAttribute("aria-hidden", "true");
        vehicle.style.backgroundImage = `url("${spriteRef.current}")`;
        vehicleMarker.current = new libre.Marker({ element: vehicle, rotationAlignment: "map", pitchAlignment: "viewport", subpixelPositioning: true });
        routeReady = true;
        showMap();
      });
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      window.clearTimeout(loadTimeout);
      vehicleMarker.current?.remove();
      vehicleMarker.current = null;
      pins.current.clear();
      instance?.remove();
    };
  }, [attempt, requested, startNorthUp, stops]);

  // Switching Mod Misi on or off swaps the basemap in place (the camera, pins and drive state stay) and re-adds our route layers.
  const shownNight = useRef(night);
  useEffect(() => {
    if (!map || !baseStyle.current || shownNight.current === night) return;
    shownNight.current = night;
    const css = getComputedStyle(container.current!);
    const token = (name: string) => css.getPropertyValue(name).trim();
    routeColors.current = { ahead: token("--color-route"), passed: token("--map-route-passed"), shine: token("--map-route-shine") };
    const next = night ? patchNightOps(baseStyle.current, mapTokens(token), { bands: lite ? 1 : undefined }) : baseStyle.current;
    map.once("style.load", () => { installOverlay(map, line, token); lastAhead.current = -1; setStyleVersion((value) => value + 1); });
    map.setStyle(next, { diff: false });
  }, [lite, line, map, night]);

  // Keep the visible middle of the map clear of the sheet and the card without resetting the camera.
  useEffect(() => {
    if (map && padding) map.setPadding(padding);
  }, [map, padding]);

  useEffect(() => {
    if (!map || driving || selectedStopId) return;
    if (overview || browsing) {
      map.fitBounds(geometry.bounds, { padding: { top: 36, bottom: 42, left: 30, right: 62 }, bearing: 0, pitch: 0, duration: 0 });
      if (angled) map.jumpTo({ pitch: 28, zoom: map.getZoom() - 0.36 });
    } else {
      map.jumpTo({ center: angled ? geometry.center : geometry.start, bearing: angled ? geometry.bearing : 0,
        pitch: angled ? 59 : 0, zoom: !angled && startNorthUp ? 12.8 : 14.6 });
    }
  }, [angled, browsing, driving, geometry, map, overview, selectedStopId, startNorthUp]);

  useEffect(() => {
    if (!map) return;
    for (const id of ["jalan-pulang-halo", "jalan-pulang-route", "jalan-pulang-route-shine"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showRoute || overview || driving ? "visible" : "none");
    }
  }, [driving, map, overview, showRoute, styleVersion]);
  useEffect(() => {
    const source = map?.getSource<GeoJSONSource>("jalan-pulang-alternatives");
    source?.setData({ type: "FeatureCollection", features: showRoute && !driving ? alternatives ?? [] : [] });
  }, [alternatives, driving, map, showRoute, styleVersion]);

  useEffect(() => {
    if (map?.getLayer("building-3d")) map.setLayoutProperty("building-3d", "visibility", angled ? "visible" : "none");
  }, [angled, map, styleVersion]);

  useEffect(() => {
    if (!map || !driving) return;
    const pause = () => { setFollowing(false); map.stop(); };
    map.on("dragstart", pause);
    return () => { map.off("dragstart", pause); };
  }, [driving, map]);

  useEffect(() => {
    if (!driving || !driveFrame) {
      const marker = vehicleMarker.current;
      if (!driving && browsing && map && marker) {
        marker.setLngLat(geometry.start).setRotation(0);
        if (!marker.getElement().isConnected) marker.addTo(map);
      } else marker?.remove();
      didFollow.current = false;
      return;
    }
    const marker = vehicleMarker.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const replay = driveFrame.replay;
    const animateReplay = replay && !reduceMotion;
    const height = map?.getContainer().clientHeight ?? 0;
    const basePadding = padding ?? { top: 0, right: 0, bottom: 0, left: 0 };

    function draw({ point, course, speedKmh }: DrivePose) {
      const [x, y] = geometry.project(point);
      outlineVehicle.current?.setAttribute("transform", `translate(${x} ${y}) rotate(${course ?? 0})`);
      if (!map || !marker) return;
      marker.setLngLat(point).setRotation(course ?? 0);
      if (!marker.getElement().isConnected) marker.addTo(map);
      if (!following) return;

      const camera = driveCamera(angled, course, height, headingUp);
      const zoom = speedKmh !== undefined ? zoomForSpeed(speedKmh) : didFollow.current ? map.getZoom() : 14.6;
      if (animateReplay) {
        // Move the camera and marker on the same frame. Asymmetric padding places the car below centre.
        map.jumpTo({ bearing: camera.bearing, pitch: camera.pitch, center: point, zoom,
          padding: { ...basePadding, top: basePadding.top + camera.offset[1] * 2 } });
      } else {
        map.easeTo({ ...camera, center: point, zoom, duration: didFollow.current && !reduceMotion ? 240 : 0 });
      }
      didFollow.current = true;
    }

    if (!animateReplay || replay.poses.length < 2) { draw(replay?.poses.at(-1) ?? driveFrame); return; }

    const { startedAt, sampleMs, poses } = replay;
    let frameId: number;
    const lastIndex = poses.length - 1;
    function animate(now: number) {
      const position = Math.max(0, (now - startedAt) / sampleMs);
      if (position >= lastIndex) { draw(poses[lastIndex]); return; }
      const index = Math.floor(position);
      draw(interpolateDrivePose(poses[index], poses[index + 1], position - index));
      frameId = requestAnimationFrame(animate);
    }
    animate(performance.now());
    return () => cancelAnimationFrame(frameId);
  }, [angled, browsing, driveFrame, driving, following, geometry, headingUp, map, padding]);

  const fraction = driveFrame?.fraction ?? null;
  useEffect(() => {
    if (vehicleMarker.current && map) vehicleMarker.current.getElement().dataset.plate = plate ?? car?.plate ?? "";
  }, [plate, car?.plate, map]);
  const totalKm = useMemo(() => routeLengthKm(line), [line]);
  const lastAhead = useRef(-1);
  useEffect(() => {
    if (!map) return;
    const lit = driving && fraction !== null;
    for (const id of ["jalan-pulang-ribbon", "jalan-pulang-chevrons"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", lit ? "visible" : "none");
    }
    const source = map.getSource("jalan-pulang-ahead") as GeoJSONSource | undefined;
    if (!source) return;
    if (!lit) { lastAhead.current = -1; source.setData({ type: "FeatureCollection", features: [] }); return; }
    const km = fraction * totalKm;
    if (Math.abs(km - lastAhead.current) < 0.15) return; // redraw about every 150 m
    lastAhead.current = km;
    source.setData(sliceAhead(line, km, 6));
  }, [driving, fraction, line, map, styleVersion, totalKm]);
  useEffect(() => {
    if (!map || !map.getLayer("jalan-pulang-route") || !map.getLayer("jalan-pulang-route-shine")) return;
    const { ahead, passed, shine } = routeColors.current;
    const split = fraction !== null && fraction > 0 ? fraction : null;
    map.setPaintProperty("jalan-pulang-route", "line-gradient", split === null
      ? undefined : ["step", ["line-progress"], passed, split, ahead]);
    map.setPaintProperty("jalan-pulang-route-shine", "line-gradient", split === null
      ? undefined : ["step", ["line-progress"], "rgba(0,0,0,0)", split, shine]);
  }, [fraction, map, styleVersion]);

  useEffect(() => {
    if (selectedStopId && online && !failed) setRequested(true);
  }, [failed, online, selectedStopId]);

  useEffect(() => {
    for (const [id, pin] of pins.current) {
      pin.dataset.selected = String(id === selectedStopId);
      pin.dataset.quest = String(questPins?.includes(id) ?? false);
      pin.dataset.questActive = String(id === activeQuestPin);
      pin.tabIndex = driving || (browsing && !questPins?.includes(id)) ? -1 : 0;
    }
    const stop = focus && focus.id === selectedStopId ? focus : stops.find((item) => item.id === selectedStopId);
    if (!map || !stop || driving) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({ center: [stop.lng, stop.lat], zoom: Math.max(map.getZoom(), 13), duration: reduceMotion ? 0 : 600 });
  }, [activeQuestPin, browsing, driving, focus, map, questPins, selectedStopId, stops]);

  // Expose the zoom level on the map element (used by the browser checks).
  useEffect(() => {
    const wrap = container.current?.parentElement;
    if (!map || !wrap) return;
    const sync = () => {
      wrap.dataset.zoom = map.getZoom().toFixed(2);
      wrap.dataset.bearing = map.getBearing().toFixed(1);
      wrap.dataset.pitch = map.getPitch().toFixed(1);
    };
    sync();
    map.on("moveend", sync);
    return () => { map.off("moveend", sync); };
  }, [map]);

  const openingPreview = browsing && !angled && preview;
  const previewImage = openingPreview ? "/kl-map-preview.jpg" : preview;
  const showPreview = previewImage && online && !map && (openingPreview || (!failed && angled)) && !overview && !driveFrame;
  const setPerspective = (perspective: boolean) => {
    if (driving) { setDriveAngled(perspective); setFollowing(true); }
    else setPlanAngled(perspective);
    if (online) setRequested(true);
  };
  const locate = () => {
    if (!map || !navigator.geolocation) { setLocateStatus("error"); return; }
    setLocateStatus("locating");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLocateStatus("idle");
      map.easeTo({ center: [coords.longitude, coords.latitude], zoom: 14, duration: 400 });
    }, () => setLocateStatus("error"), { timeout: 8000, maximumAge: 60_000 });
  };
  return <section className="map-wrap" aria-label={t(lang, "map")} data-testid="route-map"
    data-angle={angled ? "3d" : "2d"} data-frame={simulated ? "replay" : !driving && overview ? "overview" : "drive"}
    data-follow={driving ? following : undefined} data-car-paint={car?.paint} data-car-body={car?.body} data-car-trail={car?.trail}>
    <div className="map-outline" aria-hidden="true">
      <svg viewBox="0 0 390 340" preserveAspectRatio="xMidYMid meet">
        {(showRoute || overview || driving) && <><polyline className="outline-halo" points={geometry.outline} />
          <polyline className="outline-route" points={geometry.outline} /></>}
        {stops.map((stop) => {
          const [x, y] = geometry.project([stop.lng, stop.lat]);
          if (questPins?.includes(stop.id) && (!driving || stop.id === activeQuestPin)) return <image key={stop.id} href="/road-ui/quest-marker.svg" x={x - 20} y={y - 24} width="40" height="48" />;
          if (!showRoute) return null;
          return <circle className="outline-stop" key={stop.id} cx={x} cy={y} r="3" />;
        })}
        {showRoute && [geometry.end, geometry.start].map((point, index) => {
          const [x, y] = geometry.project(point);
          return <g key={index}>
            <circle className="outline-endpoint" cx={x} cy={y} r="7" />
            <text x={x + (index ? -13 : 13)} y={y + 5} textAnchor={index ? "end" : "start"}>{places[1 - index]}</text>
          </g>;
        })}
        {driving && driveFrame && <image className="road-outline-car" ref={outlineVehicle} href={vehicleSprite} x="-16" y="-20" width="32" height="42" />}
        {!driving && browsing && <image className="road-outline-car" href={vehicleSprite} x={geometry.project(geometry.start)[0] - 16} y={geometry.project(geometry.start)[1] - 20} width="32" height="42" />}
      </svg>
    </div>
    {showPreview && <img className="map-preview" src={previewImage} alt="" fetchPriority="high"
      width={openingPreview ? 585 : 760} height={openingPreview ? 1266 : 848} onClick={() => setRequested(true)} />}
    <div ref={container} className="map-canvas" data-visible={Boolean(map) && online && !failed} />
    <div className="map-tools" aria-label={t(lang, "mapView")} role="group">
      {browsing && <><button type="button" className="map-control road-map-icon" aria-label={overview ? "Hide route overview" : "Show route overview"} aria-pressed={overview}
        onClick={() => { setOverview(!overview); if (online) setRequested(true); }}><img src="/road-ui/layers.svg" alt="" /></button>
        <button type="button" className="map-control road-map-icon" disabled={!map || locateStatus === "locating"} aria-label="Locate me" onClick={locate}><img src="/road-ui/locate.svg" alt="" /></button></>}
      {browsing ? <button type="button" className="map-control map-perspective-toggle"
        data-testid={angled ? "map-2d" : "map-3d"} onClick={() => setPerspective(!angled)}>
        {angled ? "2D" : "3D"}
      </button> : <div className="map-angle" role="group" aria-label={t(lang, "perspective")}>
        {[false, true].map((perspective) => (
          <button key={String(perspective)} type="button" data-testid={perspective ? "map-3d" : "map-2d"}
            aria-pressed={perspective === angled}
            onClick={() => setPerspective(perspective)}>
            {perspective ? "3D" : "2D"}
          </button>
        ))}
      </div>}
      {!browsing && <div className="map-angle map-zoom" role="group" aria-label={t(lang, "mapView")}>
        <button type="button" data-testid="map-zoom-in" aria-label={t(lang, "mapZoomIn")} disabled={!map} onClick={() => map?.zoomIn({ duration: 250 })}>+</button>
        <button type="button" data-testid="map-zoom-out" aria-label={t(lang, "mapZoomOut")} disabled={!map} onClick={() => map?.zoomOut({ duration: 250 })}>−</button>
      </div>}
      {driving && map && online && <button type="button" className="map-control" data-testid={following ? "map-explore" : "map-recenter"}
        onClick={() => { if (following) map.stop(); setFollowing(!following); }}>{t(lang, following ? "exploreMap" : "mapRecenter")}</button>}
      {!driving && !browsing && <button type="button" className="map-control" data-testid="map-frame" disabled={!online || failed}
        onClick={() => { setOverview(!overview); if (online) setRequested(true); }}>
        {t(lang, overview ? "driveView" : "fullRoute")}
      </button>}
      {failed && online && <button type="button" className="map-control"
        onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>{t(lang, "retry")}</button>}
    </div>
    {locateStatus === "error" && <p className="road-locate-error" role="status">{t(lang, "locationFailed")}</p>}
    {!map && online && !failed ? (browsing && !manualLoad ? <p className="map-legend" role="status">{t(lang, "loading")}</p>
    : <button type="button" className="map-legend map-launch" data-testid="open-street-map"
      disabled={requested} onClick={() => setRequested(true)}>
      <span className="map-key" aria-hidden="true" />
      {t(lang, requested ? "loading" : showPreview ? "exploreMap" : "streetMap")}
    </button>) : (!browsing && !driving || !online || failed || !map) && <div className="map-legend">
      <span className="map-key" aria-hidden="true" />
      <span>{t(lang, !online || failed || !map ? "routeOutline" : overview ? "routeOverview" : "driveView")}</span>
    </div>}
    <ul className="pin-legend" aria-label={t(lang, "pinLegend")} data-testid="pin-legend">
      {PIN_LEGEND.map(({ category, label }) => <li key={category} style={{ "--c": `var(--pin-${category})` } as React.CSSProperties}><i aria-hidden="true" />{label[lang]}</li>)}
    </ul>
    <div className="map-credit">
      {((vector && online) || showPreview) && <><a href="https://openfreemap.org/">OpenFreeMap</a><span> · </span><a href="https://openmaptiles.org/">© OpenMapTiles</a><span> · </span></>}
      <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>
    </div>
  </section>;
}
