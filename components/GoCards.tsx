"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, type Lang } from "@/lib/i18n";
import { googleMapsUrl, wazeLegs, telUrl } from "@/lib/deeplinks";
import type { RouteLine } from "@/lib/route";
import { plazasAhead, quoteToll } from "@/lib/tolls";
import { track } from "@/lib/events";
import type { Need } from "@/lib/planner";
import type { RouteConfig, Stop, TollFile } from "@/lib/schemas";
import { buildEvents } from "@/lib/cruise/lookahead";
import { CruiseHud } from "./CruiseHud";
import { useCruise } from "./useCruise";
import { Source } from "./ui/Source";
import type { DriveFrame } from "@/lib/drive-camera";
import { completeQuest, levelOf, saveProgress, type Progress } from "@/lib/progress";
import { questReached, type PlacedQuest } from "@/lib/quests";
import { QuestDriveStatus, XpBadge, type QuestReward } from "./RoadGame";

/** How long the "quest complete" reward stays up during a drive. */
const REWARD_MS = 5200;

export type DriveMode = "idle" | "gps" | "sim" | "finished";
const plusLine = { number: "1-800-88-0000", source_url: "https://www.plus.com.my/customer-feedback/", retrieved_at: "2026-11-20" };

export function GoCards({ config, line, routeKm, tolls, entry, stops, plannedStops, rnrStops, needs, lang, onShare, setDriveFrame, setDriveLine, mode, setMode, driveMount, headingUp, setHeadingUp, quests = [], progress, setProgress }: {
  config: RouteConfig; line: RouteLine; routeKm: number; tolls: TollFile;
  entry: string;
  /** Planned stops that are real places (used for handoff to Google Maps and Waze). */
  stops: Stop[];
  /** Every planned stop, including evenly spaced break points (used for cruise alerts). */
  plannedStops: Stop[];
  /** Every known rest stop on the route. */
  rnrStops: Stop[];
  needs: Partial<Record<Need, boolean>>;
  lang: Lang; onShare: () => void;
  setDriveFrame: (frame: DriveFrame | null) => void;
  /** The line the drive follows after a reroute (`null`: the planned line). */
  setDriveLine?: (line: RouteLine | null) => void;
  mode: DriveMode; setMode: (mode: DriveMode) => void; driveMount: HTMLDivElement | null;
  headingUp: boolean; setHeadingUp: (value: boolean) => void;
  /** Side quests on this route, and the driver's progress (XP, the quest they are on). */
  quests?: PlacedQuest[]; progress?: Progress; setProgress?: (progress: Progress) => void;
}) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const navigationStops = stops.filter((stop) => !stop.id.startsWith("break-"));
  const legs = wazeLegs(config.destination, navigationStops);
  const destinations = [...navigationStops, config.destination];
  const googleLegs = destinations.flatMap((_, index) => {
    if (index % 4 !== 0) return [];
    const group = destinations.slice(index, index + 4);
    return [{
      destination: group.at(-1)!,
      url: googleMapsUrl(index === 0 ? config.origin : destinations[index - 1], group.at(-1)!, group.slice(0, -1)),
    }];
  });

  // Tolls, planned stops, and any stop that satisfies a selected need are what cruise mode warns about.
  const events = useMemo(() => {
    const known = new Set(rnrStops.map((stop) => stop.id));
    return buildEvents({
      plazas: tolls.plazas, stops: [...rnrStops, ...plannedStops.filter((stop) => !known.has(stop.id))],
      plannedIds: plannedStops.map((stop) => stop.id), needs,
    });
  }, [needs, plannedStops, rnrStops, tolls.plazas]);
  const slowZonesKm = useMemo(() => tolls.plazas.map((plaza) => plaza.distanceAlongRoute_km), [tolls.plazas]);

  const cruise = useCruise({
    line, routeKm, events, slowZonesKm, lang, onFrame: setDriveFrame, onLineChange: setDriveLine,
    destination: config.destination,
    onArrived: () => { if (mode === "sim") setMode("finished"); },
    onEnded: () => { setMode("idle"); requestAnimationFrame(() => trigger.current?.focus()); },
  });
  const snapshot = cruise.snapshot;
  const km = mode === "idle" ? null : snapshot?.km ?? null;

  const choose = (next: "gps" | "sim") => {
    if (next === "sim") track("sim_drive");
    setMode(next);
    if (next === "sim") cruise.startSim(); else cruise.startGps();
  };

  // Side quests: the active one shows during the drive and pays out when it is reached.
  const active = progress?.active ? quests.find((quest) => quest.id === progress.active) : undefined;
  const [reward, setReward] = useState<QuestReward | null>(null);
  useEffect(() => {
    if (!active || !progress || !setProgress || mode === "idle" || !snapshot) return;
    if (!questReached(active, { km: snapshot.km, point: snapshot.point, simulated: mode !== "gps" })) return;
    const result = completeQuest(progress, active.id, active.xp);
    saveProgress(result.progress);
    setProgress(result.progress);
    setReward({ title: active.title[lang], xp: result.gained, level: result.levelsUp > 0 ? levelOf(result.progress.xp).level : null });
  }, [active, lang, mode, progress, setProgress, snapshot]);
  useEffect(() => {
    if (!reward) return;
    const timer = window.setTimeout(() => setReward(null), REWARD_MS);
    return () => window.clearTimeout(timer);
  }, [reward]);
  const tracked = active && km !== null && active.km > km ? active : undefined;

  const nextToll = km === null ? undefined : plazasAhead(tolls, km)[0];
  const toll = nextToll ? quoteToll(tolls, entry, nextToll.id) : null;
  const rerouteUrl = `https://www.google.com/maps/dir/?api=1&destination=${config.destination.lat},${config.destination.lng}&travelmode=driving`;

  return <>
    {mode !== "idle" && driveMount && snapshot && createPortal(
      <CruiseHud lang={lang} snapshot={snapshot} destination={config.destination.name} stops={plannedStops.filter((stop) => !stop.id.startsWith("break-"))}
        simulated={mode === "sim" || mode === "finished"} headingUp={headingUp} onHeadingUp={setHeadingUp}
        muted={cruise.muted} onMute={cruise.setMuted} voiceLevel={cruise.voiceLevel} onVoiceLevel={cruise.setVoiceLevel}
        wakeStatus={cruise.wakeStatus} voiceInfo={cruise.voiceInfo} gpsLost={cruise.gpsLost} rerouteUrl={rerouteUrl} rerouteStatus={cruise.rerouteStatus}
        onExit={cruise.exit} onShare={onShare} onDetour={cruise.injectDetour}
        questStatus={<QuestDriveStatus lang={lang} quest={tracked} reward={reward ?? undefined} km={km} />} xpBadge={<XpBadge xp={progress?.xp ?? 0} lang={lang} />}
        tollInfo={nextToll && km !== null ? <>
          {t(lang, "nextToll", { n: Math.ceil(nextToll.distanceAlongRoute_km - km), name: nextToll.name })}
          {toll?.ok && toll.verified && <> · {t(lang, "tollIfExit", { n: toll.fare.toFixed(2) })}</>}
        </> : undefined} />, driveMount)}
    <section className="stack trip-content" data-testid="screen-go">
      <section className="go-drive stack" data-testid="card-progress">
        <h3>{t(lang, "liveTitle")}</h3>
        <p className="small muted">{t(lang, "locationBadge")}</p>
        <div className="go-actions">
          <button type="button" className="btn" data-testid="btn-start-drive"
            onClick={(event) => { trigger.current = event.currentTarget; choose("gps"); }}>{t(lang, "driveStart")}</button>
          <button type="button" className="btn" data-variant="primary" data-testid="btn-simulate"
            onClick={(event) => { trigger.current = event.currentTarget; choose("sim"); }}>{t(lang, "simulate")}</button>
        </div>
        {cruise.gpsError && <p role="alert">{t(lang, "gpsDenied")}</p>}
      </section>
      <details className="trip-disclosure" data-testid="card-handoff">
        <summary>{t(lang, "openNavigation")}</summary>
        <div className="stack">
          <p className="small muted">{t(lang, "goExplain")}</p>
          {googleLegs.map(({ destination, url }, index) =>
            <a className="btn" data-block="true" data-testid="nav-google"
              key={url} href={url} target="_blank" rel="noopener noreferrer" onClick={() => track("handoff_google")}>
              {googleLegs.length === 1 ? t(lang, "navGoogle") : "Google Maps · " + t(lang, "leg", { n: index + 1, name: destination.name })}
            </a>)}
          {legs.length > 1 && <p className="small muted">{t(lang, "wazeLegs")}</p>}
          {legs.map((leg) => <a className="btn" data-block="true" data-testid="nav-waze"
            key={leg.leg} href={leg.url} target="_blank" rel="noopener noreferrer" onClick={() => track("handoff_waze")}>
            {legs.length === 1 ? t(lang, "navWaze") : "Waze · " + t(lang, "leg", { n: leg.leg, name: leg.name })}
          </a>)}
        </div>
      </details>
      <details className="trip-disclosure">
        <summary>{t(lang, "tripTools")}</summary>
        <div className="stack">
          <button type="button" className="btn" data-block="true" onClick={onShare} data-testid="btn-share">{t(lang, "share")}</button>
          <div data-testid="card-emergency" className="stack">
            <h3>{t(lang, "emergencyTitle")}</h3>
            <a className="btn" data-block="true" href={telUrl(plusLine.number)}>PLUSLine {plusLine.number}</a>
            <Source label="PLUS" ts={plusLine.retrieved_at} url={plusLine.source_url} lang={lang} />
          </div>
        </div>
      </details>
    </section>
  </>;
}
