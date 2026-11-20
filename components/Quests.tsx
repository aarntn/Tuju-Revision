"use client";

import { useEffect, useState } from "react";
import { t, type Key, type Lang } from "@/lib/i18n";
import { dropQuest, EMPTY_PROGRESS, levelOf, loadProgress, saveProgress, startQuest, type Progress } from "@/lib/progress";
import { mapsSearchUrl, type PlacedQuest, type QuestCategory } from "@/lib/quests";
import { LevelBadge } from "./LevelBadge";

const CATEGORY: Record<QuestCategory, Key> = { food: "catFood", nature: "catNature", culture: "catCulture", prayer: "catPrayer" };

/** Small line icons per category, drawn on a 24 x 24 grid. */
const ICON: Record<QuestCategory, string> = {
  food: "M4 11h16a8 8 0 0 1-16 0ZM8 7c0-1.5 1-1.5 1-3M12 7c0-1.5 1-1.5 1-3M16 7c0-1.5 1-1.5 1-3",
  nature: "M2 20 9 8l4 6 3-4 6 10ZM9 8l2 3",
  culture: "M4 20V9l3-2v13M17 20V7l3 2v11M7 20V11h10v9M10 20v-4h4v4M4 9V5M20 9V5",
  prayer: "M5 20v-8a7 7 0 0 1 14 0v8ZM12 5V2M3 20h18M10 20v-4a2 2 0 0 1 4 0v4",
};

export function CategoryIcon({ category, size = 22 }: { category: QuestCategory; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round"><path d={ICON[category]} /></svg>;
}

function Stats({ quest, lang }: { quest: PlacedQuest; lang: Lang }) {
  return <ul className="quest-stats">
    <li><strong>{quest.detourKm === 0 ? t(lang, "questOnTheWay") : t(lang, "questDetour", { km: quest.detourKm })}</strong></li>
    <li><strong>{t(lang, "questExtra", { n: quest.extraMin + quest.stayMin })}</strong></li>
    <li data-xp="true"><strong>{t(lang, "questXp", { n: quest.xp })}</strong></li>
  </ul>;
}

export function Quests({ lang, quests, back, plan, initialId }: {
  lang: Lang; quests: PlacedQuest[]; back: string; plan: string; initialId?: string;
}) {
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [tab, setTab] = useState<"route" | "done">("route");
  const [openId, setOpenId] = useState<string | null>(initialId ?? null);
  useEffect(() => { setProgress(loadProgress()); }, []);

  const change = (next: Progress) => { setProgress(next); saveProgress(next); };
  const open = (id: string | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("id", id); else url.searchParams.delete("id");
    window.history.replaceState(null, "", url);
  };

  const { level, toNext } = levelOf(progress.xp);
  const quest = quests.find((item) => item.id === openId);

  if (quest) {
    const active = progress.active === quest.id;
    const done = progress.completed.includes(quest.id);
    return <main className="play-screen quest-detail" lang={lang} data-testid="screen-quest">
      <header className="play-top">
        <button type="button" className="play-back">‹ {t(lang, "back")}</button>
        <LevelBadge xp={progress.xp} lang={lang} />
      </header>
      <div className="quest-hero" data-category={quest.category}>
        <CategoryIcon category={quest.category} size={44} />
      </div>
      <p className="quest-kicker">{t(lang, "questsTitle")} · {t(lang, CATEGORY[quest.category])}{active ? ` · ${t(lang, "questActive")}` : ""}</p>
      <h1>{quest.title[lang]}</h1>
      <p className="play-sub">{quest.blurb[lang]}</p>
      <Stats quest={quest} lang={lang} />
      <p className="play-muted small">{t(lang, "questEstimate")}</p>
      <section className="play-section">
        <h2>{t(lang, "questObjectives")}</h2>
        <ol className="quest-objectives">
          {quest.objectives.map((objective, index) => <li key={index} data-done={done}>{objective[lang]}</li>)}
        </ol>
      </section>
      <p className="play-muted small">
        {quest.approximate && <>{t(lang, "questApprox")} </>}
        <a href={mapsSearchUrl(quest, lang)} target="_blank" rel="noopener noreferrer">{t(lang, "questOpenMaps")}</a>
      </p>
      <div className="play-bar">
        {done ? <p className="quest-done-note">✓ {t(lang, "questComplete")} · {t(lang, "questXp", { n: quest.xp })}</p>
          : active ? <>
            <a className="btn" data-variant="primary" data-block="true" href={plan}>{t(lang, "garageDrive")}</a>
            <button type="button" className="btn" data-block="true" data-testid="quest-drop" onClick={() => change(dropQuest(progress))}>{t(lang, "questDrop")}</button>
          </>
          : <>
          <button type="button" className="btn" onClick={() => open(null)}>{t(lang, "later")}</button>
          <a className="btn" data-variant="primary" data-block="true" data-testid="quest-start" href={plan}
            onClick={() => saveProgress(startQuest(progress, quest.id))}>{t(lang, "questStart")}</a>
          </>}
      </div>
    </main>;
  }

  const listed = tab === "done" ? quests.filter((item) => progress.completed.includes(item.id)) : quests.filter((item) => !progress.completed.includes(item.id));
  return <main className="play-screen quests" lang={lang} data-testid="screen-quests">
    <header className="play-top">
      <a className="play-back" href={back}>‹ {t(lang, "back")}</a>
      <LevelBadge xp={progress.xp} lang={lang} />
    </header>
    <p className="quest-kicker">{t(lang, "questsLevel", { n: level, xp: toNext, next: level + 1 })}</p>
    <h1>{t(lang, "questsTitle")}</h1>
    <div className="play-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "route"} onClick={() => setTab("route")}>{t(lang, "questsOnRoute")}</button>
      <button type="button" role="tab" aria-selected={tab === "done"} onClick={() => setTab("done")}>{t(lang, "questsDone")} · {progress.completed.length}</button>
    </div>
    {listed.length === 0 ? <p className="play-muted">{t(lang, tab === "done" ? "questsNoneDone" : "questsNoneOnRoute")}</p>
      : <ul className="quest-list">
        {listed.map((item) => <li key={item.id}>
          <button type="button" className="quest-card" data-testid={`quest-${item.id}`} data-active={progress.active === item.id} onClick={() => open(item.id)}>
            <span className="quest-icon" data-category={item.category}><CategoryIcon category={item.category} /></span>
            <span className="quest-card-body">
              <strong>{item.title[lang]}</strong>
              <span className="play-muted small">{item.place[lang]} · {Math.round(item.km)} km {progress.active === item.id ? `· ${t(lang, "questActive")}` : ""}</span>
              <Stats quest={item} lang={lang} />
            </span>
            <span aria-hidden="true" className="quest-chevron">›</span>
          </button>
        </li>)}
      </ul>}
  </main>;
}
