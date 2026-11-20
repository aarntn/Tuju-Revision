import type { TurnIcon } from "@/lib/directions";

/** Right-hand versions; the left ones are mirrored. Drawn on a 24 x 24 grid, stroked. */
const PATHS: Record<"straight" | "right" | "slight-right" | "sharp-right" | "uturn" | "roundabout" | "arrive", string> = {
  straight: "M12 21V4M6 10l6-6 6 6",
  right: "M7 21v-7a5 5 0 0 1 5-5h8M15 4l5 5-5 5",
  "slight-right": "M8 21v-6.5L17 5.5M11 5h6.5v6.5",
  "sharp-right": "M7 3v9a6 6 0 0 0 10.2 4.3L20 13.5M20 20v-6.5h-6.5",
  uturn: "M17 21V10a5 5 0 0 0-10 0v4M3.5 10.5 7 14l3.5-3.5",
  roundabout: "M12 21v-5M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M15 9l4-4M14.5 5H19v4.5",
  arrive: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5",
};

export function TurnArrow({ icon, small = false }: { icon: TurnIcon; small?: boolean }) {
  const mirrored = icon === "left" || icon === "slight-left" || icon === "sharp-left";
  const key = (mirrored ? icon.replace("left", "right") : icon) as keyof typeof PATHS;
  const size = small ? 16 : 34;
  return <svg className="turn-arrow" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={small ? 2.4 : 2.2} strokeLinecap="round" strokeLinejoin="round"
    style={mirrored ? { transform: "scaleX(-1)" } : undefined}>
    <path d={PATHS[key]} />
  </svg>;
}
