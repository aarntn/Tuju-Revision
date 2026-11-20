import { t, type Lang } from "./i18n";

export type Snapshot = { route: string; departure: string; toll: string; stops: string[]; weather: string; lang: Lang };
const storageKey = "jalan-pulang-trip";

export function storeSnapshot(snapshot: Snapshot) {
  try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot)); return true; }
  catch { return false; }
}

export function readSnapshot(): Snapshot | null {
  try { return JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); }
  catch { return null; }
}

export function caption(snapshot: Snapshot) {
  return [snapshot.route, snapshot.departure, snapshot.toll,
    snapshot.stops.length ? snapshot.stops.join(" · ") : t(snapshot.lang, "planNone"),
    snapshot.weather, "#BalikKampung #LaPan"].join("\n");
}

const layout = { width: 1080, height: 1350, margin: 76, title: 60, heading: 34, text: 38, line: 50, gap: 36 };

export async function snapshotImage(snapshot: Snapshot) {
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  ctx.fillStyle = token("--color-bg");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = token("--color-border");
  ctx.strokeRect(layout.margin / 2, layout.margin / 2, canvas.width - layout.margin, canvas.height - layout.margin);
  ctx.fillStyle = token("--color-text");
  const font = token("--font-body");
  const writingWidth = canvas.width - 2 * layout.margin;
  let y = layout.margin * 2;
  const line = (text: string, size: number, bold = false) => {
    ctx.font = (bold ? "600 " : "400 ") + size + "px " + font;
    let buffer = "";
    for (const word of text.split(" ")) {
      const value = buffer ? buffer + " " + word : word;
      if (buffer && ctx.measureText(value).width > writingWidth) {
        ctx.fillText(buffer, layout.margin, y, writingWidth);
        y += Math.max(layout.line, size);
        buffer = word;
      } else buffer = value;
    }
    ctx.fillText(buffer, layout.margin, y, writingWidth);
    y += Math.max(layout.line, size);
  };
  line("LaPan", layout.title, true);
  line(snapshot.route, layout.text);
  y += layout.gap;
  for (const [heading, text] of [
    [t(snapshot.lang, "departure"), snapshot.departure],
    [t(snapshot.lang, "tollTitle"), snapshot.toll],
    [t(snapshot.lang, "planTitle"), snapshot.stops.join(" · ") || t(snapshot.lang, "planNone")],
    [t(snapshot.lang, "weatherTitle"), snapshot.weather],
  ]) {
    line(heading, layout.heading, true);
    line(text, layout.text);
    y += layout.gap;
  }
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image unavailable")), "image/png"));
}

export function downloadImage(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "jalan-pulang.png";
  link.click();
}

export async function downloadSnapshot(snapshot: Snapshot) {
  const url = URL.createObjectURL(await snapshotImage(snapshot));
  downloadImage(url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
