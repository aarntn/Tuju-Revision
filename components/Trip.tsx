"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { parsePrefs, type Prefs } from "@/lib/onboarding";
import { t, fmtDur, fmtTime, type Lang } from "@/lib/i18n";
import { planStops, type Need, type PlanInput } from "@/lib/planner";
import { breakPlan } from "@/lib/breaks";
import { noStopsPlan, suggestFixes, type Fix } from "@/lib/plan-fixes";
import { APPROX, windowsFor } from "@/lib/prayer";
import { track } from "@/lib/events";
import { quoteToll } from "@/lib/tolls";
import { downloadSnapshot, storeSnapshot, type Snapshot } from "@/lib/trip-card";
import type { RnrFile, RouteConfig, TollFile } from "@/lib/schemas";
import type { EtaGrid } from "@/lib/eta-grid";
import type { RouteLine } from "@/lib/route";
import { onRoute, placeQuests, QUESTS, surauQuests } from "@/lib/quests";
import { EMPTY_PROGRESS, loadProgress, type Progress } from "@/lib/progress";
import { LeaveTimeBar, TollPicker } from "./PlanCards";
import { BreakCard, PrayerCard, StopCard, WeatherCard, type PrayerResponse, type WeatherResponse } from "./RoadCards";
import { RouteMap } from "./RouteMap";
import type { DriveFrame } from "@/lib/drive-camera";
import { DEFAULT_GARAGE, loadGarage, saveGarage, spriteUrl, VEHICLES, type GarageChoice } from "@/lib/garage";
import { loadSaved, toggleSaved } from "@/lib/saved-places";
import { dropQuest, saveProgress, startQuest } from "@/lib/progress";
import type { PlacedQuest } from "@/lib/quests";

import { GoCards, type DriveMode } from "./GoCards";
import { GameSheet, RoadIcon, XpBadge, type GameScreen } from "./RoadGame";
import { TesterTasks } from "./TesterTasks";
import { Card } from "./ui/Card";
import { Source } from "./ui/Source";

const needsList = ["toilet", "surau", "ev", "food", "fuel"] as const;
const steps = ["stepPlan", "stepRoad", "stepGo"] as const;
const FIVE_MINUTES = 300_000;
const SNAPS = ["peek", "half", "full"] as const;
type Snap = (typeof SNAPS)[number];

async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Request failed");
  return response.json();
}

export function Trip({ config, line, rnr, tolls, routeKm, date, tester, eta, initial, weatherRouteId, hasVerifiedStops, tollPartial = false, routeCard, routeOptions, alternativeLines, overlay, startOnMap, onSearchDestination, onPlanToStop, recentPlace }: {
  config: RouteConfig; line: RouteLine; rnr: RnrFile; tolls: TollFile;
  routeKm: number; date: string; tester: boolean; eta?: EtaGrid; initial: Prefs;
  /** Curated weather applies only when the trip follows the verified corridor. */
  weatherRouteId: string | null;
  /** With no verified stops on this road the plan is evenly spaced breaks with nearby-search links. */
  hasVerifiedStops: boolean;
  /** Toll shown is a lower bound: the route runs past the stretch our fares cover. */
  tollPartial?: boolean;
  routeCard?: (lang: Lang) => ReactNode; routeOptions?: (lang: Lang) => ReactNode; overlay?: (lang: Lang) => ReactNode;
  alternativeLines?: RouteLine[];
  startOnMap: boolean; onSearchDestination: () => void; recentPlace?: string;
  onPlanToStop: (stop: RnrFile["items"][number]) => void;
}) {
  const [lang, setLang] = useState<Lang>(initial.lang);
  const [testerOn, setTesterOn] = useState(tester);
  const [step, setStep] = useState(0);
  const [departure, setDeparture] = useState(date + "T09:00");
  const [vehicle, setVehicle] = useState<"petrol" | "ev">(initial.vehicle);
  const [range, setRange] = useState(initial.vehicle === "ev" ? "250" : "500");
  const [maxDrive, setMaxDrive] = useState(120);
  const [needs, setNeeds] = useState<Partial<Record<Need, boolean>>>(() => Object.fromEntries(initial.needs.map((need) => [need, true])));
  const [prayerAware, setPrayerAware] = useState(false);
  const routeEntry = tolls.plazas[0]?.id ?? "";
  const routeExit = tolls.plazas.at(-1)?.id ?? "";
  const [entry, setEntry] = useState(routeEntry);
  const [exit, setExit] = useState(routeExit);
  const selectedDate = departure.slice(0, 10);
  const [now, setNow] = useState(0);
  const [online, setOnline] = useState(true);
  const [weatherResult, setWeatherResult] = useState<{ date: string; data: WeatherResponse | null }>();
  const [prayerResult, setPrayerResult] = useState<{ date: string; data: PrayerResponse[] }>();
  const [weatherAttempt, setWeatherAttempt] = useState(0);
  const [prayerAttempt, setPrayerAttempt] = useState(0);
  const [driveFrame, setDriveFrame] = useState<DriveFrame | null>(null);
  /** Set while a drive follows a rerouted line instead of the planned one. */
  const [driveLine, setDriveLine] = useState<RouteLine | null>(null);
  const [driveMode, setDriveMode] = useState<DriveMode>("idle");
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  useEffect(() => { setProgress(loadProgress()); }, []);
  const quests = useMemo(() => onRoute(placeQuests(line, [...QUESTS, ...surauQuests(rnr.items)])), [line, rnr.items]);
  const questPins = useMemo(() => quests.map((quest) => ({
    id: quest.id, lng: quest.lng, lat: quest.lat, title: quest.title[lang],
    active: progress.active === quest.id, done: progress.completed.includes(quest.id),
  })), [lang, progress, quests]);
  const [driveMount, setDriveMount] = useState<HTMLDivElement | null>(null);
  const [headingUp, setHeadingUp] = useState(true);
  const [garage, setGarage] = useState<GarageChoice>(DEFAULT_GARAGE);
  const [saved, setSaved] = useState<string[]>([]);
  const [gameScreen, setGameScreen] = useState<GameScreen | null>(null);
  const [questId, setQuestId] = useState<string | null>(null);
  const draftQuest = quests.find((quest) => quest.id === questId);
  /** Prayer quests belong to a curated rest stop; other quests are places off the highway. */
  const questStop = (quest?: PlacedQuest) => quest ? rnr.items.find((stop) => `surau-${stop.id}` === quest.id) ?? null : null;
  const [lite, setLite] = useState(false);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [fallback, setFallback] = useState<null | "skip" | "breaks">(null);
  const [snap, setSnap] = useState<Snap>(startOnMap ? "peek" : "half");
  const [screen, setScreen] = useState({ width: 390, height: 844 });
  const drag = useRef<number | null>(null);
  const dragged = useRef(false);
  const viewport = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const visited = useRef(false);
  const weather = weatherResult?.date === selectedDate ? weatherResult.data : null;
  const prayers = useMemo(() => prayerResult?.date === selectedDate ? prayerResult.data : [], [prayerResult, selectedDate]);

  useEffect(() => {
    setGarage(loadGarage());
    setSaved(loadSaved());
    // /quests and /garage open their sheet over the map.
    const sheetParam = new URLSearchParams(window.location.search).get("sheet");
    if (sheetParam === "quests" || sheetParam === "garage") setGameScreen(sheetParam);
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    setLite(Boolean(connection?.saveData || /(^|-)[23]g$/.test(connection?.effectiveType ?? "")));
  }, []);

  // The offline fallback serves a cached bare /plan; the address bar still holds the real choices.
  useEffect(() => {
    const params = Object.fromEntries(new URLSearchParams(window.location.search));
    const fromUrl = parsePrefs(params);
    if (JSON.stringify(fromUrl) !== JSON.stringify(initial)) {
      setLang(fromUrl.lang);
      setVehicle(fromUrl.vehicle);
      setRange(fromUrl.vehicle === "ev" ? "250" : "500");
      setNeeds(Object.fromEntries(fromUrl.needs.map((need) => [need, true])));
    }
    if (params.t === "1") setTesterOn(true);
  }, [initial]);

  useEffect(() => {
    if (!visited.current) { visited.current = true; track("visit"); }
    const update = () => { setOnline(navigator.onLine); setNow(Date.now()); };
    const reconnect = () => { update(); setWeatherAttempt((n) => n + 1); setPrayerAttempt((n) => n + 1); };
    update();
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", update);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setScreen({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedStopId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedStopId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedStopId]);

  const roadOpen = step > 0;
  useEffect(() => {
    if (!roadOpen || !weatherRouteId) return;
    const controller = new AbortController();
    const loadWeather = () => {
      const query = new URLSearchParams({ route: weatherRouteId, date: selectedDate });
      request<WeatherResponse>("/api/weather?" + query, controller.signal)
        .then((data) => { if (!controller.signal.aborted) setWeatherResult({ date: selectedDate, data }); })
        .catch(() => { if (!controller.signal.aborted) setWeatherResult((previous) => previous?.date === selectedDate && previous.data ? previous : { date: selectedDate, data: null }); });
    };
    loadWeather();
    const timer = setInterval(loadWeather, FIVE_MINUTES);
    return () => { controller.abort(); clearInterval(timer); };
  }, [roadOpen, weatherRouteId, selectedDate, weatherAttempt]);

  useEffect(() => {
    if (!prayerAware) return;
    const controller = new AbortController();
    const zones = [...new Set(config.prayerZones.map(({ zone }) => zone))];
    Promise.all(zones.map(async (zone) => {
      const query = new URLSearchParams({ zone, date: selectedDate });
      try {
        return await request<PrayerResponse>("/api/prayer?" + query, controller.signal);
      } catch {
        const times = APPROX[zone];
        return times ? { date: selectedDate, zone, times, source: { label: "Approximate table", status: "estimate" as const, fetchedAt: "2026-11-20" } } : null;
      }
    })).then((data) => {
      if (!controller.signal.aborted) setPrayerResult({ date: selectedDate, data: data.filter((item) => item !== null) });
    });
    return () => controller.abort();
  }, [config.prayerZones, prayerAware, selectedDate, prayerAttempt]);

  const prayerLoading = prayerAware && prayerResult?.date !== selectedDate;
  const weatherLoading = weatherResult?.date !== selectedDate;
  const baseMinutes = Number(line.properties?.duration_s_freeflow) / 60 || routeKm / 90 * 60;
  const planInput = useMemo<PlanInput | null>(() => {
    if (prayerLoading) return null;
    const byZone = prayers.map(({ zone, date: prayerDate, times }) => windowsFor({ zone, date: prayerDate, ...times }));
    const prayerWindows = byZone[0]?.map(({ name }, index) => ({
      name,
      start: new Date(Math.max(...byZone.map((windows) => windows[index].start.getTime()))),
      end: new Date(Math.min(...byZone.map((windows) => windows[index].end.getTime()))),
    }));
    return {
      stops: rnr.items, routeKm, departureTime: new Date(departure + ":00+08:00"),
      avgSpeedKmh: routeKm * 60 / baseMinutes, vehicleType: vehicle, range_km: Number(range),
      maxDrivingMinutes: maxDrive, needs, prayerAware, prayerWindows,
    };
  }, [baseMinutes, departure, maxDrive, needs, prayerAware, prayerLoading, prayers, range, rnr.items, routeKm, vehicle]);
  const strictPlan = useMemo(() => planInput && (hasVerifiedStops ? planStops(planInput) : breakPlan(planInput, line)), [hasVerifiedStops, line, planInput]);
  // Never a dead end: an infeasible plan offers one-tap fixes, simple breaks, or going on without planned stops.
  const fixes = useMemo(() => planInput && strictPlan && !strictPlan.ok ? suggestFixes(planInput) : [], [planInput, strictPlan]);
  useEffect(() => { setFallback(null); }, [planInput]);
  const plan = useMemo(() => {
    if (!planInput || !strictPlan || strictPlan.ok || !fallback) return strictPlan;
    return fallback === "skip" ? noStopsPlan(planInput) : breakPlan(planInput, line);
  }, [fallback, line, planInput, strictPlan]);
  const breaksOnly = !hasVerifiedStops || fallback === "breaks";
  const applyPlanFix = (fix: Fix) => {
    if (fix.kind === "max-drive") setMaxDrive(fix.minutes);
    else if (fix.kind === "range") setRange(String(fix.km));
    else if (fix.kind === "prayer-off") setPrayerAware(false);
    else setNeeds({ ...needs, [fix.need]: false });
  };
  const fixLabel = (fix: Fix) => fix.kind === "max-drive" ? t(lang, "fixMaxDrive", { n: fix.minutes })
    : fix.kind === "range" ? t(lang, "fixRange", { n: fix.km })
    : fix.kind === "prayer-off" ? t(lang, "fixPrayerOff")
    : t(lang, "fixDropNeed", { need: t(lang, fix.need === "ev" ? "evCharger" : fix.need) });

  const move = (target: number) => {
    if (target === 2) track("plan_made");
    setSelectedStopId(null);
    setGameScreen(null);
    setSnap(target === 1 ? "full" : "half"); // the road plan is a list to read; Plan and Go leave the map in view
    if (target !== 2) {
      setDriveFrame(null);
      setDriveMode("idle");
    }
    setStep(target);
    requestAnimationFrame(() => {
      sheet.current?.scrollTo({ top: 0 });
      heading.current?.focus({ preventScroll: true });
    });
  };

  const planned = plan?.ok ? plan.stops.map((item) => item.stop) : [];
  const selectedStop = [...rnr.items, ...planned].find((stop) => stop.id === selectedStopId) ?? null;
  const showStop = (id: string) => {
    setSelectedStopId(id);
    const quest = quests.find((item) => item.id === `surau-${id}`);
    setQuestId(quest?.id ?? null);
    setGameScreen(quest ? "quest-place" : "place");
  };
  const closeGame = () => { setGameScreen(null); setSelectedStopId(null); setQuestId(null); };
  const openQuests = () => { setSelectedStopId(null); setQuestId(null); setGameScreen("quests"); };
  const selectQuest = (quest: PlacedQuest) => { setQuestId(quest.id); setSelectedStopId(questStop(quest)?.id ?? null); setGameScreen("quest"); };
  const nudge = (direction: 1 | -1) => setSnap((current) => SNAPS[Math.max(0, Math.min(SNAPS.length - 1, SNAPS.indexOf(current) + direction))]);

  const share = () => {
    if (!plan?.ok) return;
    const quote = quoteToll(tolls, routeEntry, routeExit);
    const current = online && weather && weather.warnings.status === "live" && now - Date.parse(weather.warnings.fetchedAt) <= 15 * 60_000;
    const snapshot: Snapshot = {
      route: config.name[lang], departure: departure.replace("T", " ") + " MYT",
      toll: quote.ok ? t(lang, "tollTotal", { n: quote.fare.toFixed(2) }) + (tollPartial ? "+" : "") : t(lang, "tollUnknown"),
      stops: plan.stops.map(({ stop }) => stop.name),
      weather: t(lang, !weather ? "unavailable" : !current ? "weatherSnapshotCached" :
        weather.warnings.items.length ? "weatherSnapshotWarning" : "weatherNone"),
      lang,
    };
    if (storeSnapshot(snapshot)) window.location.assign("/share");
    else void downloadSnapshot(snapshot);
  };

  const offlineDate = [weather?.warnings.fetchedAt, weather?.forecast.fetchedAt, rnr.retrieved_at, tolls.retrieved_at]
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  // The camera frames what is not hidden under the sheet (phone) or the left column (desktop).
  const wide = screen.width >= 900;
  const browsing = startOnMap && step === 0 && snap === "peek";
  const sheetPx = snap === "peek" ? (browsing ? 264 : 224) : Math.round(screen.height * (snap === "half" ? 0.52 : 0.88));
  const driving = step === 2 && driveMode !== "idle";
  const padding = useMemo(() => {
    if (gameScreen && gameScreen !== "garage") return { top: 70, right: 0, bottom: Math.round(screen.height * 0.64), left: 0 };
    if (browsing) return { top: 58, right: 0, bottom: sheetPx, left: 0 };
    if (wide) return { top: 0, right: 0, bottom: 0, left: 444 };
    if (driving) {
      const clearance = Math.min(160, Math.floor(screen.height / 3));
      return { top: clearance, right: 0, bottom: clearance, left: 0 };
    }
    return { top: 159, right: 0, bottom: Math.min(sheetPx, Math.max(0, screen.height - 260)), left: 0 };
  }, [browsing, driving, gameScreen, screen.height, sheetPx, wide]);

  const routeQuote = quoteToll(tolls, routeEntry, routeExit);
  const [origin, destination] = config.name[lang].split(" → ");
  return <main ref={viewport} className="app road-ui" lang={lang} data-map-sheet={gameScreen ?? undefined} data-lite={lite} data-snap={snap} data-driving={driving} data-browsing={browsing}>
    <div className="map-stage">
      <RouteMap line={driveLine ?? line} quests={driving ? questPins.filter((pin) => pin.active) : questPins}
        onSelectQuest={(id) => { const quest = quests.find((item) => item.id === id); if (quest) selectQuest(quest); }} stops={rnr.items} driveFrame={driveFrame} simulated={driveMode === "sim" || driveMode === "finished"} headingUp={headingUp} lang={lang}
        places={[origin ?? config.origin.name, destination ?? config.destination.name]} online={online}
        selectedStopId={driving ? null : selectedStopId} onSelectStop={driving ? undefined : (id) => id && showStop(id)} driving={driving}
        browsing={browsing} startNorthUp={startOnMap} lite={lite} vehicleSprite={spriteUrl(garage)} plate={garage.plate}
        showRoute={gameScreen ? gameScreen === "quest" : !browsing} alternatives={alternativeLines}
        focus={selectedStop ? { id: selectedStop.id, lat: selectedStop.lat, lng: selectedStop.lng } : null} padding={padding}
        preview={config.id === "kl-ipoh" && !process.env.NEXT_PUBLIC_TILE_URL ? "/kl-ipoh-drive-preview.webp" : undefined} />
      {!driving && !gameScreen && <header className="road-map-head"><h1 className="sr-only">{t(lang, "appName")}</h1><XpBadge xp={progress.xp} lang={lang} onClick={openQuests} />
        {!browsing && <div className="road-map-head-actions"><a href="/" className="btn language-button" aria-label="Back to map home"><RoadIcon name="home" /></a>
          <button type="button" className="btn language-button" data-testid="btn-lang" aria-label={t(lang, "langToggle")} onClick={() => setLang(lang === "en" ? "bm" : "en")}>{lang === "en" ? "BM" : "EN"}</button></div>}</header>}
      {!driving && !browsing && !gameScreen && routeCard?.(lang)}
      <div ref={setDriveMount} />
    </div>
    <div className="panel" ref={sheet} hidden={driving || Boolean(gameScreen)}>
      <button type="button" className="sheet-handle" data-testid="sheet-handle" aria-expanded={snap !== "peek"} aria-label={t(lang, "sheetHandle")}
        onClick={() => {
          if (dragged.current) { dragged.current = false; return; }
          setSnap(snap === "half" ? startOnMap && step === 0 ? "peek" : "full" : "half");
        }}
        onPointerDown={(event) => { drag.current = event.clientY; dragged.current = false; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={(event) => {
          const start = drag.current; drag.current = null;
          if (start === null) return;
          const moved = event.clientY - start;
          if (Math.abs(moved) > 40) { dragged.current = true; nudge(moved < 0 ? 1 : -1); }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") { event.preventDefault(); nudge(1); }
          if (event.key === "ArrowDown") { event.preventDefault(); nudge(-1); }
        }}><span aria-hidden="true" /></button>
      {browsing ? <section className="map-dock" data-testid="map-dock" aria-label={t(lang, "tripDetails")}>
        <button type="button" className="map-dock-search" data-testid="map-search" onClick={onSearchDestination}>
          <RoadIcon name="search" />
          {t(lang, "searchToTitle")}
        </button>
        <nav className="road-quick" aria-label="Map shortcuts">
          <button type="button" data-testid="map-open-plan" onClick={() => move(0)}><span><RoadIcon name="home" /></span><b>Home</b><small>{destination ?? config.destination.name}</small></button>
          <button type="button" onClick={openQuests}><span><RoadIcon name="quests" /></span><b>{t(lang, "questsTitle")}</b><small>{quests.filter((quest) => !progress.completed.includes(quest.id)).length} {lang === "bm" ? "di laluan" : "on route"}</small></button>
          <button type="button" onClick={() => setGameScreen("garage")}><span><RoadIcon name="garage" /></span><b>{t(lang, "garageTitle")}</b><small>{VEHICLES.find((item) => item.id === garage.vehicle)!.name[lang]}</small></button>
          <button type="button" onClick={onSearchDestination}><span><RoadIcon name="recent" /></span><b>Recent</b><small>{recentPlace ?? "Places"}</small></button>
        </nav>
      </section> : <>
      <ol className="step-progress" aria-label={t(lang, "steps")}>
        {steps.map((name, index) => {
          // Any step is reachable once the inputs it needs are valid; the current one is plain text.
          const rangeOk = Number(range) >= 1 && Number(range) <= 2000;
          const allowed = index <= step || (index === 1 ? rangeOk : rangeOk && plan?.ok === true);
          return <li key={name} aria-current={index === step ? "step" : undefined} data-reached={index <= step}>
            {index === step ? <span>{t(lang, name)}</span>
              : <button type="button" data-testid={"tab-" + ["plan", "road", "go"][index]} disabled={!allowed}
                title={allowed ? undefined : t(lang, "tabLocked")} onClick={() => move(index)}>{t(lang, name)}</button>}
          </li>;
        })}
      </ol>
      <h2 ref={heading} tabIndex={-1} className="sr-only">{t(lang, steps[step])}</h2>
      {step < 2 && <header className="trip-heading">
        <p className="trip-highway">{config.highway.replace(/northbound$/i, t(lang, "northbound"))}</p>
        <dl className="trip-metrics">
          <div><dt>{t(lang, "distance")}</dt><dd>{Math.round(routeKm)} km</dd></div>
          <div><dt>{t(lang, "estimatedDrive")}</dt><dd>{fmtDur(baseMinutes)}</dd></div>
          <div><dt>{t(lang, "classOneToll")}</dt><dd>{routeQuote.ok ? "RM " + routeQuote.fare.toFixed(2) + (tollPartial ? "+" : "") : "—"}</dd></div>
        </dl>
        {tollPartial && routeQuote.ok && <p className="small" data-testid="toll-partial">{t(lang, "tollPartialNote")}</p>}
      </header>}
      {!online && <p className="banner" data-kind="offline" role="status">{t(lang, "offline", { t: offlineDate ? offlineDate.slice(0, 10) + " " + fmtTime(new Date(offlineDate)) + " MYT" : "—" })}</p>}
      {testerOn && <TesterTasks lang={lang} compact={step > 0} />}
      {step === 0 && <section className="stack trip-content" data-testid="screen-plan">
        {routeOptions?.(lang)}
        <h3>{t(lang, "tripDetails")}</h3>
        <fieldset className="trip-needs"><legend>{t(lang, "needs")}</legend>
          {needsList.map((need) => <label className="check" key={need}>
            <input type="checkbox" checked={Boolean(needs[need])} data-testid={"need-" + need}
              onChange={(event) => setNeeds({ ...needs, [need]: event.target.checked })} />
            {t(lang, need === "ev" ? "evCharger" : need)}
          </label>)}
        </fieldset>
        {tolls.plazas.length >= 2 ? <TollPicker {...{ tolls, entry, exit, setEntry, setExit, lang }} />
          : <Card id="card-toll" title={t(lang, "tollTitle")}><p className="small">{t(lang, "noTollData")}</p></Card>}
        <details className="trip-disclosure" data-testid="trip-settings">
          <summary>{t(lang, "tripSettings")}</summary>
          <div className="stack">
            <div className="trip-fields">
              <label className="field">{t(lang, "departure")} (MYT)
                <input className="input" type="datetime-local" data-testid="departure" value={departure}
                  onChange={(event) => { if (event.target.value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(event.target.value)) setDeparture(event.target.value); }} />
              </label>
              <label className="field">{t(lang, "vehicle")}
                <select className="select" value={vehicle} onChange={(event) => {
                  const value = event.target.value === "ev" ? "ev" : "petrol";
                  setVehicle(value);
                  setRange(value === "ev" ? "250" : "500");
                }}><option value="petrol">{t(lang, "petrol")}</option><option value="ev">{t(lang, "ev")}</option></select>
              </label>
              <label className="field">{t(lang, "range")}
                <input className="input" type="number" min="1" max="2000" required value={range} onChange={(event) => setRange(event.target.value)} />
              </label>
              <label className="field">{t(lang, "maxDrive")}
                <select className="select" value={maxDrive} onChange={(event) => setMaxDrive(Number(event.target.value))}>
                  {[60, 90, 120, 150, 180].map((n) => <option key={n} value={n}>{t(lang, "minutes", { n })}</option>)}
                </select>
              </label>
            </div>
            <label className="check"><input type="checkbox" checked={prayerAware} onChange={(event) => setPrayerAware(event.target.checked)} />{t(lang, "prayerAware")}</label>
            <LeaveTimeBar {...{ config, departure, setDeparture, baseMinutes, eta, lang }} />
          </div>
        </details>
      </section>}
      {step === 1 && <section className="stack trip-content" data-testid="screen-road">
        <Card id="card-plan" title={t(lang, "planTitle")}
          source={<Source label="LaPan / OpenStreetMap" status="estimate" ts={rnr.retrieved_at} lang={lang} />}
          state={!plan ? "loading" : !plan.ok ? "error" : plan.stops.length ? "default" : "empty"}>
          {!plan ? <p role="status">{t(lang, "loading")}</p> : !plan.ok ? <><p><strong>{t(lang, "infeasible")}</strong></p>
            <p>{t(lang, ("plan_" + plan.reason) as "plan_range" | "plan_max-driving" | "plan_needs" | "plan_prayer" | "plan_no-stops")}</p>
            {fixes.length > 0 && <><p className="small">{t(lang, "fixIntro")}</p>
              <div className="stack">{fixes.map((fix) => <button type="button" className="btn" key={fix.kind + (fix.kind === "drop-need" ? fix.need : "")}
                data-testid="plan-fix" onClick={() => applyPlanFix(fix)}>{fixLabel(fix)}</button>)}</div></>}
            {hasVerifiedStops && <button type="button" className="btn" data-testid="plan-breaks" onClick={() => setFallback("breaks")}>{t(lang, "planBreaksInstead")}</button>}
            <button type="button" className="btn" data-testid="plan-skip" onClick={() => setFallback("skip")}>{t(lang, "continueNoStops")}</button></> : <>
            <p>{t(lang, "arrive", { t: fmtTime(plan.arrival) })} MYT · {t(lang, "totalTime", { d: fmtDur(plan.totalMinutes) })}</p>
            {fallback === "skip" && !plan.stops.length && <p className="small">{t(lang, "noStopsPlanned")}</p>}
            {breaksOnly && <p className="small" data-testid="breaks-note">{t(lang, "noVerifiedStops")}</p>}
            {plan.stops.length ? <ul className="list">{plan.stops.map((item) => <li key={item.stop.id}>{item.stop.id.startsWith("break-")
              ? <BreakCard stop={item.stop} planned={item} needs={needs} lang={lang} onShow={() => showStop(item.stop.id)} />
              : <StopCard stop={item.stop} planned={item} lang={lang} onShow={() => showStop(item.stop.id)} />}</li>)}</ul> :
              fallback === "skip" ? null : <p>{t(lang, "planNone")}</p>}
            {prayerAware && <p className="small">{t(lang, "prayerPlanningNote")}</p>}
          </>}
        </Card>
        {prayerAware && <PrayerCard data={prayers} loading={prayerLoading} now={now} lang={lang} noCoverage={config.prayerZones.length === 0}
          retry={() => { setPrayerResult(undefined); setPrayerAttempt((n) => n + 1); }} />}
        <WeatherCard data={weather} loading={weatherLoading} now={now} lang={lang} offline={!online} noCoverage={!weatherRouteId}
          retry={() => { setWeatherResult(undefined); setWeatherAttempt((n) => n + 1); }} />
        {rnr.items.length > 0 && <details className="trip-disclosure" data-testid="all-stops">
          <summary>{t(lang, "allStops")}</summary>
          <div className="stack">
            <p className="small muted">{t(lang, "facilitiesUnknown")}</p>
            <ul className="list">{rnr.items.map((stop) => <li key={stop.id}><StopCard {...{ stop, lang }} onShow={() => showStop(stop.id)} /></li>)}</ul>
          </div>
        </details>}
      </section>}
      {step === 2 && plan?.ok && <GoCards {...{ config, line, tolls, routeKm, lang, setDriveFrame, setDriveLine, driveMount }} entry={routeEntry} mode={driveMode} setMode={setDriveMode}
        stops={planned} plannedStops={planned} rnrStops={rnr.items} needs={needs}
        headingUp={headingUp} setHeadingUp={setHeadingUp} onShare={share} quests={quests} progress={progress} setProgress={setProgress} />}
      {step < 2 && <nav className="step-nav" aria-label={t(lang, "steps")}>
        {step > 0 && <button type="button" className="btn" data-testid="btn-back" onClick={() => move(0)}>{t(lang, "back")}</button>}
        <button type="button" className="btn" data-variant="primary" data-testid="btn-next" onClick={() => move(step + 1)}
          disabled={step === 0 ? Number(range) < 1 || Number(range) > 2000 : !plan?.ok}>
          {t(lang, step === 0 ? "reviewRoute" : "continueToGo")} <span aria-hidden="true">→</span>
        </button>
      </nav>}
      <footer className="stack foot trip-footer">
        <div className="row">
          <a href={"/about?lang=" + lang}>{t(lang, "dataPrivacy")}</a>
          {testerOn && <a href="/qr">{t(lang, "testerQr")}</a>}
        </div>
        <div className="row">
          <Source label="OSRM / OpenStreetMap" ts={String(line.properties?.retrieved_at ?? "")}
            url={String(line.properties?.source_url ?? "https://www.openstreetmap.org/")} lang={lang} />
          {routeQuote.ok && <Source label="PLUS" ts={tolls.retrieved_at} url={tolls.source_url}
            status={routeQuote.verified ? undefined : "unverified"} lang={lang} />}
        </div>
      </footer>
      </>}
    </div>
    {gameScreen && <GameSheet screen={gameScreen} progress={progress} garage={garage} saved={saved} quests={quests} quest={draftQuest} stop={selectedStop} lang={lang}
      onClose={closeGame} onBack={() => gameScreen === "quest-place" && draftQuest ? selectQuest(draftQuest) : gameScreen === "quest" ? openQuests() : closeGame()}
      onQuest={selectQuest} onQuestPlace={() => setGameScreen("quest-place")}
      onStart={(quest) => { const next = startQuest(progress, quest.id); saveProgress(next); setProgress(next); closeGame(); move(plan?.ok ? 2 : 1); }}
      onDrop={() => { const next = dropQuest(progress); saveProgress(next); setProgress(next); }}
      onApplyCar={(choice) => { saveGarage(choice); setGarage(choice); closeGame(); }}
      onSave={(stop) => setSaved((value) => toggleSaved(value, stop.id))} onRoutes={(stop) => { closeGame(); onPlanToStop(stop); }} />}
    {overlay?.(lang)}
  </main>;
}
