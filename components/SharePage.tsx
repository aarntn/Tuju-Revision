"use client";

import { useEffect, useState } from "react";
import { caption, downloadImage, readSnapshot, snapshotImage, type Snapshot } from "@/lib/trip-card";
import { t } from "@/lib/i18n";
import { track } from "@/lib/events";

export function SharePage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [image, setImage] = useState<{ file: File; url: string }>();
  const [status, setStatus] = useState<"copied" | "shareFailed" | "">("");
  useEffect(() => {
    const data = readSnapshot();
    setSnapshot(data);
    if (!data) return;
    let active = true;
    let objectUrl: string | undefined;
    snapshotImage(data).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setImage({ file: new File([blob], "jalan-pulang.png", { type: "image/png" }), url: objectUrl });
    }).catch(() => { if (active) setStatus("shareFailed"); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, []);
  const lang = snapshot?.lang ?? "en";
  const text = snapshot ? caption(snapshot) : "";
  const share = async () => {
    if (!image) return;
    try {
      if (navigator.canShare?.({ files: [image.file] })) {
        await navigator.share({ title: "LaPan", text, files: [image.file] });
      } else downloadImage(image.url);
      track("share");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) setStatus("shareFailed");
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setStatus("copied"); }
    catch { setStatus("shareFailed"); }
  };
  return <main className="page stack" lang={lang} data-testid="screen-share">
    <h1>{t(lang, "share")}</h1>
    {snapshot ? <>
      {image ? <img className="trip-preview" src={image.url} width={1080} height={1350} alt={t(lang, "share")} /> :
        <div className="placeholder">{t(lang, status ? "shareFailed" : "loading")}</div>}
      <div className="row">
        <button type="button" className="btn" data-variant="primary" disabled={!image} onClick={() => void share()}>{t(lang, "shareOrSave")}</button>
        <button type="button" className="btn" onClick={() => void copy()}>{t(lang, "copyCaption")}</button>
      </div>
      <label className="field">{t(lang, "caption")}<textarea className="input caption" readOnly value={text} rows={7} /></label>
    </> : <p>{t(lang, "shareEmpty")}</p>}
    {status && <p role="status">{t(lang, status)}</p>}
    <a className="btn" href="/plan">{t(lang, "backToPlan")}</a>
  </main>;
}
