import type { Lang } from "@/lib/i18n";
import { levelOf, titleOf } from "@/lib/progress";

/** "12 · Road warrior" pill with an XP bar, shown on the Garage and Side quests screens. */
export function LevelBadge({ xp, lang }: { xp: number; lang: Lang }) {
  const { level, intoLevel, levelSize } = levelOf(xp);
  return <span className="level-badge" data-testid="level-badge" aria-label={`Level ${level}, ${titleOf(level)[lang]}`}>
    <b>{level}</b>
    <span>{titleOf(level)[lang]}</span>
    <i aria-hidden="true"><i style={{ width: `${Math.round((intoLevel / levelSize) * 100)}%` }} /></i>
  </span>;
}
