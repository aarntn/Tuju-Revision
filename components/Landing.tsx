"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { groupCopy } from "@/lib/group-copy";
import { prefsQuery, type Prefs } from "@/lib/onboarding";
import { DEFAULT_GARAGE, frameUrl, loadGarage, VEHICLES } from "@/lib/garage";
import { levelOf, loadProgress } from "@/lib/progress";

export function Landing({ initial, tester, home }: { initial: Prefs; tester: boolean; home: boolean }) {
  const [lang, setLang] = useState(initial.lang);
  const [garage, setGarage] = useState(DEFAULT_GARAGE);
  const [xp, setXp] = useState(0);
  useEffect(() => { setGarage(loadGarage()); setXp(loadProgress().xp); }, []);
  const extra: Record<string, string> = tester ? { t: "1" } : {};
  const prefs = { ...initial, lang };
  const query = prefsQuery(prefs, extra);
  const showHome = home;

  return <main className="landing" data-view={showHome ? "home" : "welcome"} lang={lang}
    data-testid={showHome ? "screen-home" : "screen-landing"}>
    <header className="landing-top">
      <p className="landing-brand">
        <span className="brand-dot" aria-hidden="true" />
        {t(lang, "appName")}
      </p>
      <button type="button" className="btn language-button" data-testid="landing-lang" aria-label={t(lang, "langToggle")}
        onClick={() => setLang(lang === "en" ? "bm" : "en")}>{lang === "en" ? "BM" : "EN"}</button>
    </header>
    {showHome ? <section className="landing-home">
      {tester && <p className="landing-tester" role="note">{t(lang, "testerStrip")}</p>}
      <h1>{t(lang, "homeTitle")}</h1>
      <p>{t(lang, "homeSub")}</p>
      <img className="home-map" src="/kl-ipoh-drive-preview.webp" alt="" />
      <a className="btn landing-cta" data-variant="primary" data-testid="home-plan"
        href={"/plan" + query}>{t(lang, "planMyDrive")}</a>
      <nav className="play-links" aria-label={t(lang, "questsTitle")}>
        <a className="play-link" href={"/quests" + prefsQuery({ lang })} data-testid="home-quests">
          <span className="quest-icon" data-category="food" aria-hidden="true">!</span>
          <strong>{t(lang, "questsTitle")}</strong>
          <span>{t(lang, "questsLevel", { n: levelOf(xp).level, xp: levelOf(xp).toNext, next: levelOf(xp).level + 1 })}</span>
        </a>
        <a className="play-link" href={"/garage" + prefsQuery({ lang })} data-testid="home-garage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frameUrl(garage, 0)} alt="" />
          <strong>{t(lang, "garageTitle")}</strong>
          <span>{VEHICLES.find((v) => v.id === garage.vehicle)!.name[lang]}</span>
        </a>
      </nav>
      <nav className="landing-links" aria-label={t(lang, "homeMore")}>
        <a href={"/group-arrival" + prefsQuery({ lang })}>{groupCopy(lang, "title")}</a>
        <a href={"/about" + prefsQuery({ lang })}>{t(lang, "dataPrivacy")}</a>
      </nav>
    </section> : <section className="landing-welcome">
      <div className="welcome-art" aria-hidden="true" />
      <div className="welcome-content">
        <h1>{t(lang, "landingTitle")}</h1>
        <p>{t(lang, "landingSub")}</p>
        <a className="btn landing-cta welcome-cta" data-testid="landing-start"
          href={"/" + prefsQuery(prefs, { ...extra, home: "1" })}>{t(lang, "getStarted")}</a>
      </div>
    </section>}
  </main>;
}
