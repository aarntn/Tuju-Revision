/** Places the driver starred from a place sheet. Stored on the phone only; offered first in place search. */
const KEY = "lapan-saved-places";

export function parseSaved(raw: string | null): string[] {
  try {
    const data = JSON.parse(raw ?? "[]");
    return Array.isArray(data) ? [...new Set(data.filter((id): id is string => typeof id === "string"))] : [];
  } catch {
    return [];
  }
}

export function loadSaved(): string[] {
  try { return parseSaved(localStorage.getItem(KEY)); } catch { return []; }
}

export function toggleSaved(saved: string[], id: string): string[] {
  const next = saved.includes(id) ? saved.filter((item) => item !== id) : [...saved, id];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: lasts this visit */ }
  return next;
}
