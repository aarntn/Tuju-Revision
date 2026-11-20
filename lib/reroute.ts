import type { RouteEvent } from "./cruise/lookahead";
import type { RouteLine } from "./route";
import type { RouteOption } from "./routing";

/** A route option from /api/route as a line the cruise engine and the map understand, steps included. */
export function rerouteLine(option: RouteOption, source: string, fetchedAt: string): RouteLine {
  return {
    type: "Feature",
    properties: {
      routeId: "reroute", distance_m: option.distance_m, duration_s_freeflow: option.duration_s,
      source, source_url: "https://project-osrm.org/", retrieved_at: fetchedAt, verified: false,
      ...(option.steps ? { steps: option.steps } : {}),
    },
    geometry: { type: "LineString", coordinates: option.geometry.coordinates },
  };
}

/**
 * Moves look-ahead events from the original route onto a new route to the same destination. A reroute rejoins the
 * original road, so an event's distance *to the destination* is kept. Events now behind the start are dropped.
 */
export function shiftEvents(events: RouteEvent[], originalKm: number, newKm: number): RouteEvent[] {
  const shift = originalKm - newKm;
  return events.map((event) => ({ ...event, km: event.km - shift })).filter((event) => event.km >= 0);
}
