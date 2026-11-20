"use client";

import { useEffect, useRef, useState } from "react";
import {
  cleanPlate, DEFAULT_GARAGE, FRAMES, frameUrl, loadGarage, PAINTS, ROOF_BOX_LEVEL, saveGarage, VEHICLES, type GarageChoice,
} from "@/lib/garage";
import { t, type Lang } from "@/lib/i18n";
import { EMPTY_PROGRESS, levelOf, loadProgress } from "@/lib/progress";
import { LevelBadge } from "./LevelBadge";

/** Pixels of drag per turntable frame. */
const DRAG_PX = 28;
const AUTO_SPIN_MS = 700;

export function Garage({ lang, back }: { lang: Lang; back: string }) {
  const [choice, setChoice] = useState<GarageChoice>(DEFAULT_GARAGE);
  const [xp, setXp] = useState(EMPTY_PROGRESS.xp);
  const [frame, setFrame] = useState(0);
  const [touched, setTouched] = useState(false);
  const drag = useRef<{ x: number; frame: number } | null>(null);

  useEffect(() => { setChoice(loadGarage()); setXp(loadProgress().xp); }, []);

  // A slow showroom spin until the user takes over (none at all with reduced motion).
  useEffect(() => {
    if (touched || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setFrame((value) => value + 1), AUTO_SPIN_MS);
    return () => window.clearInterval(timer);
  }, [touched]);

  // Warm every angle of the current vehicle so spinning never waits on the network.
  useEffect(() => {
    for (let i = 0; i < FRAMES; i++) { const image = new Image(); image.src = frameUrl(choice, i); }
  }, [choice]);

  const update = (patch: Partial<GarageChoice>) => setChoice((current) => ({ ...current, ...patch }));
  const turn = (step: number) => { setTouched(true); setFrame((value) => value + step); };
  const level = levelOf(xp).level;
  const vehicle = VEHICLES.find((v) => v.id === choice.vehicle)!;

  return <main className="play-screen garage" lang={lang} data-testid="screen-garage">
    <header className="play-top">
      <a className="play-back" href={back}>‹ {t(lang, "back")}</a>
      <LevelBadge xp={xp} lang={lang} />
    </header>
    <h1>{t(lang, "garageTitle")}</h1>
    <p className="play-sub">{t(lang, "garageSub")}</p>

    <figure className="garage-stage"
      onPointerDown={(event) => { setTouched(true); drag.current = { x: event.clientX, frame }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (drag.current) setFrame(drag.current.frame - Math.round((event.clientX - drag.current.x) / DRAG_PX)); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frameUrl(choice, frame)} alt={`${vehicle.name[lang]}, ${PAINTS.find((p) => p.id === choice.paint)!.name[lang]}`}
        width={480} height={360} draggable={false} data-testid="garage-preview" />
      <figcaption>
        <button type="button" className="garage-turn" aria-label={t(lang, "garagePrev")} onClick={() => turn(-1)}>‹</button>
        <span>{t(lang, "garageSpin")}</span>
        <button type="button" className="garage-turn" aria-label={t(lang, "garageNext")} onClick={() => turn(1)}>›</button>
      </figcaption>
      <span className="garage-plate" aria-label={t(lang, "garagePlate")}>{choice.plate}</span>
    </figure>

    <section className="play-section" aria-labelledby="garage-vehicle">
      <h2 id="garage-vehicle" className="sr-only">{t(lang, "garageVehicle")}</h2>
      <div className="garage-vehicles" role="radiogroup" aria-label={t(lang, "garageVehicle")}>
        {VEHICLES.map((item) => <button key={item.id} type="button" role="radio" aria-checked={choice.vehicle === item.id}
          className="garage-vehicle" data-testid={`vehicle-${item.id}`} onClick={() => update({ vehicle: item.id })}>
          <strong>{item.name[lang]}</strong>
          <span>{item.blurb[lang]}</span>
        </button>)}
      </div>
    </section>

    <section className="play-section" aria-labelledby="garage-paint">
      <h2 id="garage-paint">{t(lang, "garagePaint")}</h2>
      <div className="garage-paints" role="radiogroup" aria-labelledby="garage-paint">
        {PAINTS.map((paint) => <button key={paint.id} type="button" role="radio" aria-checked={choice.paint === paint.id}
          aria-label={paint.name[lang]} title={paint.name[lang]} className="garage-paint" data-testid={`paint-${paint.id}`}
          style={{ background: paint.hex }} onClick={() => update({ paint: paint.id })} />)}
      </div>
    </section>

    <section className="play-section play-rows">
      <label className="play-row">
        <span>{t(lang, "garagePlate")}</span>
        <input className="garage-plate-input" value={choice.plate} maxLength={10} autoComplete="off" spellCheck={false}
          data-testid="garage-plate" onChange={(event) => update({ plate: cleanPlate(event.target.value) })}
          onBlur={() => update({ plate: choice.plate.trim() || DEFAULT_GARAGE.plate })} />
      </label>
      <div className="play-row" data-locked={level < ROOF_BOX_LEVEL}>
        <span>{t(lang, "garageRoofBox")}</span>
        <span className="play-muted">{level < ROOF_BOX_LEVEL ? `🔒 ${t(lang, "garageLocked", { n: ROOF_BOX_LEVEL })}` : "✓"}</span>
      </div>
    </section>

    <div className="play-bar">
      <a className="btn" data-variant="primary" data-block="true" data-testid="garage-save" href={back}
        onClick={() => saveGarage({ ...choice, plate: choice.plate.trim() || DEFAULT_GARAGE.plate })}>{t(lang, "garageDrive")}</a>
    </div>
  </main>;
}
