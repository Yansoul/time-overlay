import type { AnalyticsEventName, AnalyticsEventPayload } from "./events";

type PvuvFunction = {
  (...args: unknown[]): void;
  q?: unknown[][];
};
declare global {
  interface Window { pvuv?: PvuvFunction }
}

export function trackPvuvEvent(
  event: AnalyticsEventName,
  payload: AnalyticsEventPayload,
  location: Pick<Location, "hostname" | "pathname"> = window.location,
): void {
  if (process.env.NODE_ENV !== "production" ||
    !["timeoverlay.co", "www.timeoverlay.co"].includes(location.hostname) ||
    /^\/live(?:\/|$)/.test(location.pathname)) return;
  // Purchase comes from verified server state. The legacy export alias says
  // nothing beyond download_requested and would double-count that milestone.
  if (event === "pro_purchase_verified" || event === "export_completed") return;
  try {
    if (!window.pvuv) {
      const queued: PvuvFunction = (...args) => { queued.q = [...(queued.q ?? []), args]; };
      window.pvuv = queued;
    }
    window.pvuv("event", event, payload);
  } catch { /* Tracking must not interrupt an export or checkout. */ }
}
