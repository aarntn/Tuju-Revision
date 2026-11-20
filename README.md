# LaPan

LaPan is a phone-friendly trip planner for Kuala Lumpur → Ipoh via the North–South Expressway. Plan a stop, check toll and weather, and hand off navigation to Google Maps or Waze. The bilingual interface pairs a perspective map with a phone-sized planning sheet.

[Open Jalan Pulang](https://jalan-pulang.vercel.app/) · [Tester mode](https://jalan-pulang.vercel.app/?t=1) · [Printable tester QR](https://jalan-pulang.vercel.app/qr)

## Run locally

Use Node.js 22 or 24 and npm.

```sh
npm ci
npm test
npm run dev
```

Open http://localhost:3000. For service-worker testing, run `npm run build` and `npm start`. A secure context is required for installation and phone GPS. A lightweight preview captured from the 3D map renders first. Tap a map control to open the interactive street map in perspective on a compatible device. The simulated drive follows the saved line. The outline works without tiles or WebGL.

- `/?t=1` opens the three tester tasks and optional anonymous feedback.
- `/group-arrival` creates a meetup invite and private host link. Group Arrival requires a private Vercel Blob store in production and runs in memory during local development.
- `/qr` generates a printable QR code for the tester link.
- `/share` previews the trip card created in Go and offers PNG sharing or download and caption copy.
- `/about` lists sources and privacy practices. `/states` and [DESIGN_HANDOFF.md](DESIGN_HANDOFF.md) document the wireframe.
- `/stats?key=…` uses a private deployment value for `STATS_KEY`. Keep the link private. Counts are approximate tabs, with a separate total for each event. Use optional Upstash REST credentials for durable counters. Without Redis, each server process keeps its own temporary totals and feedback.

The [feature checklist](FEATURES.md) maps this build to the original brief.

## Data and limitations

| Data | Source and interpretation |
|---|---|
| Route | The saved OSRM route leaves the expressway at Simpang Pulai. The app uses this geometry and its free-flow time to estimate a plan. Navigation providers may choose a different route. |
| Toll | The [PLUS calculator](https://www.plus.com.my/#toll-fare-calculator) returned RM20.34 for a Class 1 private car from Jalan Duta to Simpang Pulai. Fixture responses contain the checked prices. Other unsupported entry/exit combinations remain unverified. PLUS separately quoted RM21.73 from Jalan Duta to Ipoh Selatan, an exit outside this route. |
| R&R | OpenStreetMap provides locations. The [PLUS facilities directory](https://www.plus.com.my/our-facilities/) confirms northbound Tapah's toilet, surau, EV charger, food court, fuel and ATM, plus northbound Tanjong Malim's fuel and toilets. Individual facilities shown with a question mark are unknown. Charger availability is not a live feed. |
| Weather | The MET Malaysia endpoints on data.gov.my are proxied and cached for five minutes. Warning locations are matched by district or state name. Saved data or fixtures retain their retrieval time. A stale empty result never claims clear current conditions. |
| Prayer | JAKIM e-Solat supplies monthly times for the configured zones. Other dates use labelled approximate times. The planner uses the overlap of zone windows and assumes short travel across adjacent zones. Confirm local times before prayer. |
| Departure | The festive and normal profiles are heuristic, with no live traffic feed. The optional Google Routes script reads `GOOGLE_MAPS_API_KEY` from the script's environment, caps requests at 50 and saves predicted times for a specific route/date. No Google key is required to run the site. |
| Breakdown | [PLUSLine](https://www.plus.com.my/customer-feedback/) covers emergencies on the PLUS expressway. |
| Rejected or deferred | The flood-warning dataset was excluded because current corridor coverage and freshness were not verified. CCTV and last-mile GTFS-Realtime are outside the shipped corridor flow. |

Weather and prayer upstreams can be checked with `npm run probe`. The `--save` flag refreshes the fixtures. Update the fixture retrieval timestamps in the corresponding API handlers when refreshing them. The route and POI scripts run offline against saved inputs or explicitly request fresh data. Keep changes to a route bundled together under `data/routes/<id>` and add it to `lib/data.ts`.

Location is snapped in the browser and stays there. Map tiles use OpenFreeMap with OpenStreetMap data by default. Set NEXT_PUBLIC_TILE_URL to override it with a raster tile endpoint. The raster map preserves camera tilt. Building height is available with the vector map at close zoom where mapped. Browser GPS updates only the on-device position marker. The camera follows the bundled route during simulation. Anonymous analytics accepts an event type and an optional random tab token, which is folded into an aggregate session count. Feedback is optional free text. The app does not store IPs, cookies or browser fingerprints.

## Demo and social post

1. Open `/?t=1` on a phone. Show the Class 1 toll and choose Surau and EV charger. Show the estimated departure bar.
2. Tap Road. Show Tapah Northbound, the weather source stamp and the prayer timetable if enabled.
3. Tap Go and open the Google Maps handoff. In the app, run Simulate drive and open the trip card.
4. Show the printable QR. Use private stats to confirm the number of outside testers, then include only real counts and feedback shared with permission.

Draft post

> We built LaPan for balik kampung trips from Kuala Lumpur to Ipoh. Check the toll, find a surau and EV charging stop, see the weather along the way, then open Google Maps or Waze. No account needed. Try the three tasks at https://jalan-pulang.vercel.app/?t=1. #BalikKampung #LaPan

Add the verified tester count after the testing round.
