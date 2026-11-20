/** Side-quest progress: XP, level, finished quests and the quest being driven to. Stored on the phone only. */
export type Progress = { xp: number; completed: string[]; active: string | null };

const KEY = "lapan-progress";
export const EMPTY_PROGRESS: Progress = { xp: 0, completed: [], active: null };

/** XP needed to reach `level` from zero: 0, 100, 300, 600, … (each level asks 100 more than the last). */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

export function levelOf(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const floor = xpForLevel(level), next = xpForLevel(level + 1);
  return { level, intoLevel: xp - floor, levelSize: next - floor, toNext: next - xp };
}

const TITLES: [number, { en: string; bm: string }][] = [
  [10, { en: "Road warrior", bm: "Pahlawan jalan raya" }],
  [6, { en: "Kampung cruiser", bm: "Pengembara kampung" }],
  [3, { en: "Weekend wanderer", bm: "Pengembara hujung minggu" }],
  [1, { en: "Learner driver", bm: "Pemandu baru" }],
];
export const titleOf = (level: number) => TITLES.find(([min]) => level >= min)![1];

export function parseProgress(raw: string | null): Progress {
  try {
    const data = raw ? JSON.parse(raw) : {};
    return {
      xp: Number.isFinite(data.xp) && data.xp >= 0 ? Math.floor(data.xp) : 0,
      completed: Array.isArray(data.completed) ? data.completed.filter((id: unknown) => typeof id === "string") : [],
      active: typeof data.active === "string" ? data.active : null,
    };
  } catch {
    return EMPTY_PROGRESS;
  }
}

export function loadProgress(): Progress {
  try { return parseProgress(localStorage.getItem(KEY)); } catch { return EMPTY_PROGRESS; }
}

export function saveProgress(progress: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* storage blocked */ }
}

export const startQuest = (progress: Progress, id: string): Progress => ({ ...progress, active: id });
export const dropQuest = (progress: Progress): Progress => ({ ...progress, active: null });

/** Finishing a quest pays its XP once. Returns the new progress and how many levels were gained. */
export function completeQuest(progress: Progress, id: string, xp: number): { progress: Progress; gained: number; levelsUp: number } {
  if (progress.completed.includes(id)) return { progress: { ...progress, active: progress.active === id ? null : progress.active }, gained: 0, levelsUp: 0 };
  const before = levelOf(progress.xp).level;
  const next: Progress = { xp: progress.xp + xp, completed: [...progress.completed, id], active: progress.active === id ? null : progress.active };
  return { progress: next, gained: xp, levelsUp: levelOf(next.xp).level - before };
}
