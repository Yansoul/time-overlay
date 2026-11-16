// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
import posthog from "posthog-js";
import { trackEvent } from "@/lib/analytics/events";
import { trackPvuvEvent } from "@/lib/analytics/pvuv-client";

beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); window.pvuv = vi.fn<(...args: unknown[]) => void>(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); delete window.pvuv; });
it("forwards events on production host and preserves existing providers", () => {
  trackPvuvEvent("export_generated", { format: "mp4" }, { hostname: "timeoverlay.co", pathname: "/" });
  expect(window.pvuv).toHaveBeenCalledWith("event", "export_generated", { format: "mp4" });
  trackEvent("export_started", {});
  expect(posthog.capture).toHaveBeenCalledWith("export_started", {});
});
it("excludes local, preview, live overlays and development", () => {
  for (const location of [
    { hostname: "localhost", pathname: "/" }, { hostname: "preview.vercel.app", pathname: "/" },
    { hostname: "timeoverlay.co", pathname: "/live" }, { hostname: "timeoverlay.co", pathname: "/live/foo" },
  ]) trackPvuvEvent("editor_viewed", {}, location);
  vi.stubEnv("NODE_ENV", "development");
  trackPvuvEvent("editor_viewed", {}, { hostname: "timeoverlay.co", pathname: "/" });
  expect(window.pvuv).not.toHaveBeenCalled();
});
it("never forwards the return-page purchase event or legacy export alias", () => {
  for (const event of ["pro_purchase_verified", "export_completed"] as const) {
    trackPvuvEvent(event, {}, { hostname: "timeoverlay.co", pathname: "/" });
  }
  expect(window.pvuv).not.toHaveBeenCalled();
});
it("queues before the script loads and isolates analytics failures", () => {
  delete window.pvuv;
  trackPvuvEvent("editor_viewed", {}, { hostname: "timeoverlay.co", pathname: "/" });
  expect((window as Window).pvuv?.q?.length).toBe(1);
  window.pvuv = () => { throw new Error("analytics broken"); };
  expect(() => trackPvuvEvent("editor_viewed", {}, { hostname: "timeoverlay.co", pathname: "/" })).not.toThrow();
});
