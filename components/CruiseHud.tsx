"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cruiseConfig } from "@/lib/cruise/config";
import type { CruiseSnapshot } from "@/lib/cruise/engine";
import { cueDistances, instruction, turnIcon } from "@/lib/directions";
import type { RerouteStatus } from "./useCruise";
import { TurnArrow } from "./TurnArrow";
import type { Alert, VoiceLevel } from "@/lib/cruise/lookahead";
import type { WakeStatus } from "@/lib/cruise/wakelock";
import { driveProgress } from "@/lib/drive-progress";
import { fmtTime, t, type Key, type Lang } from "@/lib/i18n";
import type { Stop } from "@/lib/schemas";

const VOICE_ORDER: VoiceLevel[] = ["full", "normal", "reduced"];
const VOICE_LABEL: Record<VoiceLevel, Key> = { full: "cruiseVoiceFull", normal: "cruiseVoiceNormal", reduced: "cruiseVoiceReduced" };
const FACILITY_LABEL: Record<string, Key> = { surau: "surau", toilet: "toilet", fuel: "fuel", ev: "evCharger", food: "food", atm: "atm" };
const RECOVERED_MS = 4000;
/** A turn this close (km) is shown even over a rest-stop banner. */
const TURN_SHOW_KM = 3;
const EXIT_CONFIRM_MS = 3000;

const metres = (km: number) => `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
const distance = (km: number) => (km < 1 ? metres(km) : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

const urgency = (a: Alert, b: Alert) => b.level - a.level || a.distKm - b.distKm;

export function CruiseHud({
  lang, snapshot, destination, stops, simulated, headingUp, onHeadingUp, muted, onMute, voiceLevel, onVoiceLevel,
  wakeStatus, voiceInfo, gpsLost = false, rerouteUrl, rerouteStatus = "idle", onExit, onShare, onDetour, tollInfo, questStatus, xpBadge,
}: {
  lang: Lang; snapshot: CruiseSnapshot; destination: string; stops: Stop[]; simulated: boolean;
  headingUp: boolean; onHeadingUp: (value: boolean) => void; muted: boolean; onMute: (value: boolean) => void;
  voiceLevel: VoiceLevel; onVoiceLevel: (value: VoiceLevel) => void;
  wakeStatus: WakeStatus; voiceInfo: { available: boolean; fellBack: boolean }; gpsLost?: boolean;
  rerouteUrl: string; rerouteStatus?: RerouteStatus; onExit: () => void; onShare: () => void; onDetour?: () => void; tollInfo?: ReactNode;
  /** The active side quest tracker, or the "quest complete" reward. */
  questStatus?: ReactNode; xpBadge?: ReactNode;
}) {
  const { state, alerts, remainingKm, km, offRouteM } = snapshot;
  const [now, setNow] = useState(() => Date.now());
  const [exitArmed, setExitArmed] = useState(false);
  const shown = useRef<{ cards: Record<string, number>; banners: Record<string, number> }>({ cards: {}, banners: {} });
  const previous = useRef(state);
  const [recoveredAt, setRecoveredAt] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(tick); }, []);

  // Remember when each level was first reached so cards and banners can dismiss themselves.
  useEffect(() => {
    for (const { id, level } of snapshot.reached) {
      if (level === 2) shown.current.cards[id] = Date.now();
      if (level === 3) shown.current.banners[id] = Date.now();
    }
  }, [snapshot]);

  useEffect(() => {
    if (previous.current === "OFF_ROUTE" && state === "CRUISING") setRecoveredAt(Date.now());
    previous.current = state;
  }, [state]);

  useEffect(() => {
    if (!exitArmed) return;
    const timer = window.setTimeout(() => setExitArmed(false), EXIT_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [exitArmed]);

  const sorted = [...alerts].sort(urgency);
  const banner = sorted.find((a) => a.level === 3 && now - (shown.current.banners[a.event.id] ?? now) < cruiseConfig.l3HoldMs);
  const cards = snapshot.cardsSuppressed ? [] : sorted.filter((a) => a.level === 2 && now - (shown.current.cards[a.event.id] ?? 0) < cruiseConfig.cardDismissMs && a !== banner);
  const chips = snapshot.cardsSuppressed ? [] : sorted.filter((a) => a.level === 1).slice(0, 3);
  const recovered = recoveredAt !== null && now - recoveredAt < RECOVERED_MS;
  const turn = snapshot.turn;
  const turnUrgent = turn !== null && turn.distKm <= cueDistances(snapshot.speedKmh / 3.6).near;
  // Close turns outrank everything; otherwise a rest-stop banner comes first and the turn shows when it is a few km away.
  const showTurn = turn !== null && !arrivedNow(snapshot) && (turnUrgent || (!banner && turn.distKm <= TURN_SHOW_KM));

  const progress = driveProgress(km, offRouteM, remainingKm === null || km === null ? 0 : km + remainingKm, stops);
  const next = progress.state === "moving" ? progress.next : undefined;
  const arrived = snapshot.arrived;
  const eta = snapshot.etaMs !== null ? fmtTime(new Date(snapshot.etaMs)) : "—";
  const name = (a: Alert) => (a.event.kind === "break" ? t(lang, "breakAt", { n: a.event.id.replace("break-", "") }) : a.event.name);
  const facilities = (a: Alert) => a.event.facilities.filter((key) => FACILITY_LABEL[key]).map((key) => t(lang, FACILITY_LABEL[key]));

  const announcement = state === "ARMED" ? t(lang, "cruiseArming")
    : state === "OFF_ROUTE" ? t(lang, rerouteStatus === "finding" ? "rerouting" : "cruiseOff")
    : showTurn && turn ? `${distance(turn.distKm)} ${instruction(lang, turn.maneuver, destination)}`
    : banner ? `${name(banner)} ${distance(banner.distKm)}` : arrived ? t(lang, "cruiseArrived") : "";

  const cycleVoice = () => onVoiceLevel(VOICE_ORDER[(VOICE_ORDER.indexOf(voiceLevel) + 1) % VOICE_ORDER.length]);
  const confirmExit = () => { if (exitArmed) onExit(); else setExitArmed(true); };

  return <section className="drive-hud cruise-hud" data-testid="screen-drive" data-state={state} aria-labelledby="drive-heading">
    <div className="cruise-top">
      <div className="drive-instruction cruise-banner" data-testid="cruise-banner" data-level={showTurn ? "turn" : banner ? 3 : state === "OFF_ROUTE" ? "off" : state === "ARRIVING" ? "arriving" : 1}>
        <h2 id="drive-heading" className="drive-mode" ref={heading} tabIndex={-1}>
          {t(lang, simulated ? "simulation" : "driveView")}<span className="sr-only" data-testid="cruise-state">{state}</span>
        </h2>
        {state === "ARMED" ? <p className="drive-message" role="status" data-testid="drive-status">{t(lang, rerouteStatus === "found" ? "rerouted" : "cruiseArming")}</p>
          : state === "OFF_ROUTE" ? <div className="cruise-off">
            <p className="drive-message" role="status" data-testid="drive-status">{t(lang, rerouteStatus === "finding" ? "rerouting" : rerouteStatus === "failed" ? "rerouteFailed" : "cruiseOff")}</p>
            {rerouteStatus === "failed" && <a className="btn cruise-reroute" data-testid="cruise-reroute" href={rerouteUrl} target="_blank" rel="noopener noreferrer">{t(lang, "cruiseReroute")}</a>}
          </div>
          : arrived ? <p className="drive-message" role="status" data-testid="drive-status">{t(lang, "cruiseArrived")}</p>
          : showTurn && turn ? <div className="drive-next cruise-turn" data-testid="cruise-turn" data-icon={turnIcon(turn.maneuver)}>
            <strong data-testid="turn-distance"><TurnArrow icon={turnIcon(turn.maneuver)} />{distance(turn.distKm)}</strong>
            <div>
              <p className="drive-context">{t(lang, "turnNext")}</p>
              <p className="drive-place" data-testid="turn-instruction">{instruction(lang, turn.maneuver, destination)}</p>
              {turn.then && <p className="cruise-facilities cruise-then">
                <TurnArrow icon={turnIcon(turn.then)} small />{instruction(lang, turn.then, destination)}
              </p>}
            </div>
          </div>
          : banner ? <div className="drive-next">
            <strong data-testid="drive-next-distance">{distance(banner.distKm)}</strong>
            <div>
              <p className="drive-context">{t(lang, banner.event.kind === "toll" ? "cruiseTollL3" : "cruiseNextUp")}</p>
              <p className="drive-place" data-testid="drive-next-name">{name(banner)}</p>
              {facilities(banner).length > 0 && <p className="cruise-facilities">{facilities(banner).join(" · ")}</p>}
            </div>
          </div>
          : progress.state === "moving" ? <div className="drive-next">
            <strong data-testid="drive-next-distance">{Math.ceil(next?.distanceKm ?? progress.remainingKm)} <span>km</span></strong>
            <div>
              <p className="drive-context">{state === "ARRIVING" ? t(lang, "cruiseArriving") : t(lang, next ? "driveNextPlanned" : "driveDestination")}</p>
              <p className="drive-place" data-testid="drive-next-name">{next?.stop.name ?? destination}</p>
            </div>
          </div>
          : <p className="drive-message" role="status" data-testid="drive-status">{t(lang, "driveLocating")}</p>}
        {recovered && state === "CRUISING" && <p className="cruise-recovered" data-testid="cruise-recovered" role="status">{t(lang, "cruiseBack")}</p>}
      </div>

      {questStatus}
      {chips.length > 0 && <ul className="cruise-chips" aria-label={t(lang, "cruiseNextUp")}>
        {chips.map((a) => <li key={a.event.id} data-testid="cruise-chip">{name(a)} · {distance(a.distKm)}</li>)}
      </ul>}

      {cards.map((a) => <aside key={a.event.id} className="cruise-card" data-testid="cruise-card" data-planned={a.event.planned}>
        <strong>{name(a)}</strong>
        <span>{distance(a.distKm)}</span>
        {facilities(a).length > 0 && <p>{facilities(a).join(" · ")}</p>}
      </aside>)}

      {gpsLost && <p className="cruise-notice" role="status" data-testid="cruise-gps-lost">{t(lang, "cruiseGpsLost")}</p>}
      {(wakeStatus === "unsupported" || wakeStatus === "denied") && <p className="cruise-notice" role="status" data-testid="cruise-wake-warning">{t(lang, "cruiseWakeOff")}</p>}
      {!voiceInfo.available && <p className="cruise-notice" role="status" data-testid="cruise-voice-warning">{t(lang, "cruiseVoiceOff")}</p>}
      {voiceInfo.available && voiceInfo.fellBack && <p className="cruise-notice" role="status">{t(lang, "cruiseVoiceFallback")}</p>}
    </div>

    <div className="cruise-controls" role="group" aria-label={t(lang, "cruiseVoiceTitle")}>
      <button type="button" className="cruise-round" data-testid="cruise-mute" aria-pressed={muted}
        aria-label={t(lang, muted ? "cruiseUnmute" : "cruiseMute")} onClick={() => onMute(!muted)}>{muted ? "🔇" : "🔊"}</button>
      <button type="button" className="cruise-round" data-testid="cruise-heading" aria-pressed={headingUp}
        aria-label={t(lang, headingUp ? "cruiseHeadingUp" : "cruiseNorthUp")} onClick={() => onHeadingUp(!headingUp)}>{headingUp ? "↑" : "N"}</button>
      <button type="button" className="cruise-round cruise-voice" data-testid="cruise-voice" aria-label={t(lang, "cruiseVoiceTitle") + ": " + t(lang, VOICE_LABEL[voiceLevel])}
        onClick={cycleVoice}>{t(lang, VOICE_LABEL[voiceLevel])}</button>
    </div>

    {arrived && <div className="cruise-arrived" data-testid="cruise-arrived" role="dialog" aria-label={t(lang, "cruiseArrived")}>
      <h3>{t(lang, "cruiseArrived")}</h3>
      <p>{destination}</p>
      <div className="cruise-arrived-actions">
        <button type="button" className="btn" data-variant="primary" data-testid="cruise-finish" onClick={onExit}>{t(lang, "cruiseFinish")}</button>
        <button type="button" className="btn" data-testid="cruise-share" onClick={onShare}>{t(lang, "cruiseShareCard")}</button>
      </div>
    </div>}

    <div className="road-drive-xp">{xpBadge}</div>
    <div className="drive-summary cruise-strip" data-testid="drive-progress">
      {tollInfo && state === "CRUISING" && <p className="drive-toll">{tollInfo}</p>}
      <div className="cruise-stats">
        <div data-testid="cruise-speed"><strong>{Math.round(snapshot.speedKmh)}</strong><span>{t(lang, "cruiseSpeedUnit")}</span></div>
        <div data-testid="cruise-eta"><strong>{eta}</strong><span>{t(lang, "cruiseEta")} · {t(lang, "cruiseEstimate")}</span></div>
        <div data-testid="cruise-left"><strong>{remainingKm === null ? "—" : arrived ? 0 : Math.ceil(remainingKm)}</strong><span>{t(lang, "cruiseLeft")}</span></div>
      </div>
      <progress className="drive-progress" aria-label={t(lang, "driveProgressLabel")} max={1} value={snapshot.fraction ?? 0} />
      <div className="cruise-actions">
        {simulated && onDetour && state === "CRUISING" && <button type="button" className="btn" data-testid="cruise-detour" onClick={onDetour}>{t(lang, "cruiseDetour")}</button>}
        <button type="button" className="btn drive-end" data-testid={simulated ? "btn-stop-replay" : "btn-stop-drive"}
          data-armed={exitArmed} onClick={confirmExit}>{exitArmed ? t(lang, "cruiseExitConfirm") : t(lang, simulated ? "endSimulation" : "cruiseExit")}</button>
      </div>
    </div>
    <p className="sr-only" aria-live="polite">{announcement}</p>
  </section>;
}

function arrivedNow(snapshot: CruiseSnapshot) { return snapshot.arrived || snapshot.state === "OFF_ROUTE" || snapshot.state === "ARMED"; }
