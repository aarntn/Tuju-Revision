# Jalan Pulang feature checklist

Based on the numbered features and engagement requirements in `CLAUDE_CODE_PROMPT.md`.

| Brief | What is available |
| --- | --- |
| F1 · Route corridor | Saved KL → Ipoh GeoJSON along the North–South Expressway, with an interactive 2D/3D map (loads on its own, wheel and button zoom, tappable stop pins with a details callout, "Show on map" from the stops list) and full-route overview. |
| F2 · Toll calculator | Entry and exit selection with verified PLUS Class 1 fares where available. Unknown fare pairs show a PLUS lookup link. |
| F3 · R&R planner | Rest, vehicle range, fuel, EV charging, toilets, surau and food preferences. Optional prayer-aware planning with JAKIM times and a labelled approximate fallback. |
| F4 · Corridor weather | MET Malaysia forecasts and best-effort route warning matching with cache, source and freshness labels. |
| F5 · Navigation handoff | Google Maps with supported waypoints and Waze links for each leg. |
| F6 · Data provenance | Reusable source and freshness labels, including cached, stale and estimated states. |
| F7 · Departure advisor | Festive and normal-day heuristic estimates, calendar export and a capped optional Google Routes build script. The site uses the heuristics unless a dated grid has been generated. |
| F8 · Drive progress | Browser-only GPS snapping, nearby R&R and toll information, and route-following simulation. |
| F9 · Shareable trip card | PNG trip card, caption copy and native sharing where supported, with download as the fallback. |
| F10 · Highway assistance | An official tap-to-call PLUSLine card for this PLUS corridor. |
| F11 · GTFS-R last-mile module | Outside the current build. |
| F12 · Offline PWA | Cached app shell, saved corridor and trip planning, and previously fetched weather and prayer data. The offline route outline substitutes for street tiles. |

## Engagement and app support

- English and Bahasa Malaysia trip flows and Group Arrival screens.
- Map-first: the app opens on the planner at `/plan` (the old onboarding was removed; `/onboarding` redirects there).
- Tester mode at `/?t=1` with three tasks and optional anonymous feedback.
- Printable tester QR, share page, protected stats, a data and privacy page, and preview states for the UI.
- The tester counters use temporary server memory unless the separate Redis integration is configured.

## Follow-up feature

**Group Arrival** gives each event a guest link and a private host link. Guests join with a nickname, post revised arrival times, and mark themselves on track or arrived. The app groups traffic reports from the same stretch and counts guests expected after the published start. The host can publish a new start, and the event page updates while open. Reports use guest-entered data and the room shares no GPS coordinates.
