import profile from "@/data/heuristics/festive-profile.json";
import type { EtaGrid } from "./eta-grid";

export function departureOptions(routeId: string, date: string, baseMinutes: number, festive: boolean, eta?: EtaGrid) {
  if (eta?.routeId === routeId && eta.date === date) {
    return { slots: eta.grid, label: "Google Routes", ts: eta.retrieved_at, url: eta.source_url, predicted: true };
  }
  const slots = Object.entries(profile.profiles[festive ? "festive" : "normal"])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, multiplier]) => ({ depart: hour + ":00", duration_min: Math.round(baseMinutes * multiplier) }));

  return { slots, label: "LaPan", ts: profile.retrieved_at, url: profile.source_url, predicted: false };
}

export function calendarEvent(name: string, start: Date, minutes: number) {
  const stamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const title = name.replace(/\\/g, "\\\\").replace(/[,;]/g, "\\$&").replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LaPan//Trip//EN", "BEGIN:VEVENT",
    "UID:" + start.getTime() + "@jalan-pulang", "DTSTAMP:" + stamp(new Date()),
    "DTSTART:" + stamp(start), "DTEND:" + stamp(new Date(start.getTime() + minutes * 60_000)),
    "SUMMARY:" + title, "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
