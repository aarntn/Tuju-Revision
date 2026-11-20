"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cleanPlate, DEFAULT_GARAGE, FRAMES, frameUrl, PAINTS, ROOF_BOX_LEVEL, VEHICLES, type GarageChoice } from "@/lib/garage";
import { t, type Key, type Lang } from "@/lib/i18n";
import { levelOf, titleOf, type Progress } from "@/lib/progress";
import { mapsSearchUrl, type PlacedQuest, type QuestCategory } from "@/lib/quests";
import type { Stop } from "@/lib/schemas";
import { Facilities } from "./RoadCards";

/**
 * The game layer from DESIGN.md as sheets over the map: XP badge, side quests, quest and place details, Garage,
 * the driving quest tracker and the reward toast. Data comes from lib/quests, lib/progress and lib/garage.
 */
export type GameScreen = "quests" | "quest" | "quest-place" | "place" | "garage";
export type QuestReward = { title: string; xp: number; level: number | null };

const CATEGORY: Record<QuestCategory, Key> = { food: "catFood", nature: "catNature", culture: "catCulture", prayer: "catPrayer" };
/** Pixels of drag per turntable frame. */
const DRAG_PX = 28;

export function RoadIcon({ name }: { name: string }) {
  return <img className="road-icon" src={`/road-ui/${name}.svg`} alt="" aria-hidden="true" />;
}

export function XpBadge({ xp, lang, onClick }: { xp: number; lang: Lang; onClick?: () => void }) {
  const { level, intoLevel, levelSize } = levelOf(xp);
  const rank = titleOf(level)[lang];
  const label = `Level ${level}, ${rank}, ${xp} XP`;
  const contents = <><b>{level}</b><span>{rank}<progress value={intoLevel} max={levelSize} aria-label="XP to next level" /></span></>;
  return onClick ? <button type="button" className="road-xp" data-testid="level-badge" aria-label={`${label}. ${t(lang, "questsTitle")}`} onClick={onClick}>{contents}</button>
    : <div className="road-xp" data-testid="level-badge" aria-label={label}>{contents}</div>;
}

export function QuestDriveStatus({ quest, reward, km, lang }: { quest?: PlacedQuest; reward?: QuestReward; km: number | null; lang: Lang }) {
  if (reward) return <aside className="road-reward" role="status" data-testid="quest-toast"><RoadIcon name="star" />
    <span><small>{t(lang, "questComplete")}{reward.level ? ` · ${t(lang, "questLevelUp", { n: reward.level })}` : ""}</small><strong>+{reward.xp} XP</strong></span></aside>;
  if (!quest) return null;
  const ahead = km !== null ? Math.max(0, Math.ceil(quest.km - km)) : null;
  return <aside className="road-tracker" data-testid="cruise-quest"><small>{t(lang, "questsTitle")} · +{quest.xp} XP</small><strong>{quest.title[lang]}</strong>
    <span>{ahead !== null ? t(lang, "questAhead", { d: `${ahead} km` }) : quest.objectives[0][lang]}</span></aside>;
}

function QuestFacts({ quest, lang }: { quest: PlacedQuest; lang: Lang }) {
  return <dl className="road-facts">
    <div><dt>{lang === "bm" ? "Lencongan" : "Detour"}</dt><dd>{quest.detourKm === 0 ? "0 km" : `${quest.detourKm} km`}</dd></div>
    <div><dt>{lang === "bm" ? "Masa tambahan" : "Adds"}</dt><dd>{quest.extraMin + quest.stayMin} min</dd></div>
    <div><dt>{lang === "bm" ? "Ganjaran XP" : "XP reward"}</dt><dd>+{quest.xp} XP</dd></div>
  </dl>;
}

function Garage({ garage, xp, lang, onApply }: { garage: GarageChoice; xp: number; lang: Lang; onApply: (choice: GarageChoice) => void }) {
  const [choice, setChoice] = useState(garage);
  const [frame, setFrame] = useState(0);
  const drag = useRef<{ x: number; frame: number } | null>(null);
  // Warm every angle so spinning never waits on the network.
  useEffect(() => { for (let i = 0; i < FRAMES; i++) { const image = new Image(); image.src = frameUrl(choice, i); } }, [choice]);
  const vehicle = VEHICLES.find((item) => item.id === choice.vehicle)!;
  const paint = PAINTS.find((item) => item.id === choice.paint)!;
  return <>
    <div className="road-garage-preview">
      <span className="road-preview-label">{t(lang, "garageVehicle")}</span>
      <span className="garage-plate" aria-label={t(lang, "garagePlate")}>{choice.plate}</span>
      <button type="button" className="road-turntable" aria-label={`${vehicle.name[lang]}, ${paint.name[lang]}. ${t(lang, "garageSpin")}`}
        onPointerDown={(event) => { drag.current = { x: event.clientX, frame }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (drag.current) setFrame(drag.current.frame - Math.round((event.clientX - drag.current.x) / DRAG_PX)); }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setFrame((value) => value + (event.key === "ArrowRight" ? 1 : -1)); }
        }} onClick={(event) => { if (event.detail === 0) setFrame((value) => value + 1); }}>
        <RoadIcon name="turntable" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="garage-render" src={frameUrl(choice, frame)} alt="" draggable={false} data-testid="garage-preview" />
      </button>
      <span className="road-turn-hint"><RoadIcon name="rotate" />{t(lang, "garageSpin")}</span>
    </div>
    <div className="road-filters" role="group" aria-label={t(lang, "garageVehicle")}>
      {VEHICLES.map((item) => <button type="button" key={item.id} data-testid={`vehicle-${item.id}`} aria-pressed={item.id === choice.vehicle}
        onClick={() => setChoice({ ...choice, vehicle: item.id })}>{item.id === choice.vehicle && "✓ "}{item.name[lang]}</button>)}
    </div>
    <p className="road-quest-meta">{vehicle.blurb[lang]}</p>
    <h3>{t(lang, "garagePaint")}</h3>
    <div className="road-swatches" role="group" aria-label={t(lang, "garagePaint")}>
      {PAINTS.map((item) => <button type="button" key={item.id} data-testid={`paint-${item.id}`} aria-label={item.name[lang]} title={item.name[lang]}
        aria-pressed={item.id === choice.paint} style={{ "--paint": item.hex } as CSSProperties} onClick={() => setChoice({ ...choice, paint: item.id })} />)}
    </div>
    <details className="road-garage-extra"><summary className="road-extra"><span><strong>{t(lang, "garagePlate")}</strong><small>{choice.plate}</small></span><RoadIcon name="chevron" /></summary>
      <label className="road-plate-field">{t(lang, "garagePlate")}<input className="input garage-plate-input" value={choice.plate} maxLength={10} autoComplete="off" spellCheck={false}
        data-testid="garage-plate" onChange={(event) => setChoice({ ...choice, plate: cleanPlate(event.target.value) })} /></label></details>
    <div className="road-extra" data-locked={levelOf(xp).level < ROOF_BOX_LEVEL}><span><strong>{t(lang, "garageRoofBox")}</strong>
      <small>{levelOf(xp).level < ROOF_BOX_LEVEL ? t(lang, "garageLocked", { n: ROOF_BOX_LEVEL }) : "✓"}</small></span></div>
    <footer className="road-sheet-actions"><button className="btn" type="button" data-variant="primary" data-testid="garage-save"
      onClick={() => onApply({ ...choice, plate: choice.plate.trim() || DEFAULT_GARAGE.plate })}>{t(lang, "garageDrive")}</button></footer>
  </>;
}

type GameSheetProps = {
  screen: GameScreen; progress: Progress; garage: GarageChoice; saved: string[];
  quests: PlacedQuest[]; quest?: PlacedQuest; stop: Stop | null; lang: Lang;
  onClose: () => void; onBack: () => void; onQuest: (quest: PlacedQuest) => void; onQuestPlace: () => void;
  onStart: (quest: PlacedQuest) => void; onDrop: () => void; onApplyCar: (choice: GarageChoice) => void;
  onSave: (stop: Stop) => void; onRoutes: (stop: Stop) => void;
};

export function GameSheet({ screen, progress, garage, saved, quests, quest, stop, lang, onClose, onBack, onQuest, onQuestPlace, onStart, onDrop, onApplyCar, onSave, onRoutes }: GameSheetProps) {
  const [filter, setFilter] = useState<"route" | "nearby" | "done">("route");
  const title = useRef<HTMLHeadingElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const { level, toNext } = levelOf(progress.xp);
  const place = screen === "place" || screen === "quest-place";
  const isSaved = stop ? saved.includes(stop.id) : false;
  useEffect(() => { sheet.current?.scrollTo({ top: 0 }); title.current?.focus({ preventScroll: true }); }, [screen]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  let content: ReactNode;
  if (screen === "quests") {
    const done = (item: PlacedQuest) => progress.completed.includes(item.id);
    const filtered = quests.filter((item) => filter === "done" ? done(item) : !done(item) && (filter !== "nearby" || item.detourKm <= 10));
    content = <>
      <header className="road-sheet-head"><div><small>{t(lang, "questsLevel", { n: level, xp: toNext, next: level + 1 })}</small><h2 ref={title} tabIndex={-1} id="road-sheet-title">{t(lang, "questsTitle")}</h2></div>
        <button type="button" className="road-close" aria-label={t(lang, "closeCard")} onClick={onClose}>×</button></header>
      <div className="road-filters" role="group" aria-label={t(lang, "questsTitle")}>
        {([["route", t(lang, "questsOnRoute")], ["nearby", lang === "bm" ? "Berdekatan" : "Nearby"], ["done", t(lang, "questsDone")]] as const).map(([value, label]) =>
          <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{filter === value && "✓ "}{label}</button>)}
      </div>
      <ul className="road-quest-list">{filtered.map((item) => <li key={item.id}>
        <button type="button" className="road-quest-row" data-testid={`quest-${item.id}`} onClick={() => onQuest(item)}>
          <span className="road-quest-glyph"><RoadIcon name={done(item) ? "check" : "quest-marker"} /></span>
          <span><strong>{item.title[lang]}</strong>
            <span className="road-quest-meta">{item.detourKm === 0 ? t(lang, "questOnTheWay") : t(lang, "questDetour", { km: item.detourKm })} · {t(lang, "questExtra", { n: item.extraMin + item.stayMin })}</span>
            <span className="road-quest-tags"><b>+{item.xp} XP</b><small>{progress.active === item.id ? t(lang, "questActive") : t(lang, CATEGORY[item.category])}</small></span></span>
          <RoadIcon name="chevron" />
        </button></li>)}</ul>
      {!filtered.length && <p className="muted" role="status">{t(lang, filter === "done" ? "questsNoneDone" : "questsNoneOnRoute")}</p>}
      <footer className="road-sheet-actions"><button type="button" className="btn" onClick={onClose}>{t(lang, "later")}</button></footer>
    </>;
  } else if (screen === "garage") {
    content = <><header className="road-garage-top"><button type="button" className="road-back" onClick={onClose}><RoadIcon name="back" /> {t(lang, "back")}</button><XpBadge xp={progress.xp} lang={lang} /></header>
      <h2 ref={title} tabIndex={-1} id="road-sheet-title">{t(lang, "garageTitle")}</h2><p className="muted road-garage-caption">{t(lang, "garageSub")}</p>
      <Garage garage={garage} xp={progress.xp} lang={lang} onApply={onApplyCar} /></>;
  } else {
    const visited = quest ? progress.completed.includes(quest.id) : false;
    const active = quest ? progress.active === quest.id : false;
    content = <>
      {place && stop && <div className="road-place-actions"><span className="road-place-category"><RoadIcon name={quest ? "quest-marker" : "place-category"} /></span>
        <button type="button" className="btn" aria-pressed={isSaved} onClick={() => onSave(stop)}>{isSaved ? "★ Saved" : "☆ Save place"}</button></div>}
      {quest && <small className="road-quest-overline">{t(lang, "questsTitle")} · {t(lang, CATEGORY[quest.category])}</small>}
      <h2 ref={title} tabIndex={-1} id="road-sheet-title">{place ? stop?.name : quest?.title[lang]}</h2>
      {quest && !place && <p className="road-quest-meta">{quest.place[lang]} · {Math.round(quest.km)} km</p>}
      {stop && place && <p className="road-quest-meta">{t(lang, "kmFromStart", { n: Math.round(stop.distanceAlongRoute_km) })}</p>}
      {quest ? <>
        {place && <h3>{lang === "bm" ? "Ganjaran misi" : "Quest rewards"}</h3>}
        <QuestFacts quest={quest} lang={lang} />
        <p className="road-quest-meta">{t(lang, "questEstimate")}</p>
        <h3>{t(lang, "questObjectives")}</h3>
        <ul className="road-objectives">{quest.objectives.map((objective, index) =>
          <li key={index}><span data-done={visited || (active && index === 0)}>{visited || (active && index === 0) ? "✓" : ""}</span>{objective[lang]}</li>)}</ul>
        <p className="road-quest-meta">{quest.approximate && <>{t(lang, "questApprox")} </>}
          <a href={mapsSearchUrl(quest, lang)} target="_blank" rel="noopener noreferrer">{t(lang, "questOpenMaps")}</a></p>
        {!place && stop && <button type="button" className="road-text-action" onClick={onQuestPlace}>{lang === "bm" ? "Lihat butiran hentian" : "View stop details"} <RoadIcon name="chevron" /></button>}
      </> : stop && <><h3>{lang === "bm" ? "Kemudahan" : "Onsite services"}</h3><Facilities stop={stop} lang={lang} />
        <h3>{lang === "bm" ? "Waktu dibuka" : "Opening hours"}</h3><p className="road-quest-meta">{lang === "bm" ? "Waktu belum disahkan." : "Hours are unverified."}</p></>}
      <footer className="road-sheet-actions">
        {quest && active ? <button type="button" className="btn" data-testid="quest-drop" onClick={onDrop}>{t(lang, "questDrop")}</button>
          : <button type="button" className="btn" onClick={onClose}>{quest ? t(lang, "later") : lang === "bm" ? "Pergi nanti" : "Go later"}</button>}
        {quest ? <button type="button" className="btn" data-variant="primary" data-testid="quest-start" disabled={visited} onClick={() => onStart(quest)}>
          {visited ? t(lang, "questComplete") : active ? (lang === "bm" ? "Teruskan misi" : "Continue quest") : t(lang, "questStart")}</button>
          : <button type="button" className="btn" data-variant="primary" onClick={() => stop && onRoutes(stop)}>{lang === "bm" ? "Lihat laluan" : "View routes"}</button>}
      </footer>
    </>;
  }

  return <>
    {screen !== "quests" && screen !== "garage" && <div className="road-sheet-map-nav"><button type="button" className="road-close" aria-label={t(lang, "back")} onClick={onBack}>‹</button>
      <button type="button" className="road-close" aria-label={t(lang, "closeCard")} onClick={onClose}>×</button></div>}
    <section ref={sheet} className="road-sheet" data-screen={screen} aria-labelledby="road-sheet-title">
      {screen !== "garage" && <div className="road-sheet-grabber" aria-hidden="true" />}
      {content}
    </section>
  </>;
}
