import Stripe from "stripe";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/pro/webhook/route";

const secret = "whsec_local_fixture";
const stripe = new Stripe("sk_test_local_fixture");
const fetchMock = vi.fn();
const session = {
  id: "cs_live_fixture", object: "checkout.session", mode: "payment", livemode: true,
  payment_status: "paid", amount_total: 600, currency: "usd",
  metadata: { product: "time-overlay-pro", pvuv_visitor_id: "abc123def456", trigger: "direct" },
};
function request(object = session, type = "checkout.session.completed", signature = true) {
  const body = JSON.stringify({ id: "evt_fixture", type, livemode: true, data: { object } });
  return new Request("https://timeoverlay.co/api/pro/webhook", { method: "POST", body,
    headers: { "stripe-signature": signature ? stripe.webhooks.generateTestHeaderString({ payload: body, secret }) : "bad" },
  });
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_fixture");
  vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_fixture");
  vi.stubEnv("PRO_LICENSE_SECRET", "local_fixture");
  vi.stubEnv("STRIPE_PRO_WEBHOOK_SECRET", secret);
  vi.stubEnv("PVUV_SITE", "fixture_site");
  vi.stubEnv("PVUV_INGEST_TOKEN", "fixture_ingest");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(Response.json({ accepted: 1, duplicate: 0, rejected: [] }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe("verified purchase reporting", () => {
  it("rejects invalid signatures before reporting", async () => {
    expect((await POST(request(session, undefined, false))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("ignores other products, unpaid and test purchases", async () => {
    for (const object of [
      { ...session, metadata: { ...session.metadata, product: "other" } },
      { ...session, payment_status: "unpaid" }, { ...session, livemode: false },
      { ...session, mode: "subscription" },
    ]) expect((await POST(request(object))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports only anonymous purchase data in major currency units", async () => {
    expect((await POST(request())).status).toBe(200);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.events[0]).toMatchObject({ name: "purchase", revenue: 6, currency: "USD", visitor_id: "abc123def456" });
    expect(body.events[0].id.length).toBeLessThanOrEqual(64);
    expect(body.events[0]).not.toHaveProperty("email");
  });
  it("uses the same dedup id across completed, async success and retries", async () => {
    await POST(request());
    fetchMock.mockResolvedValue(Response.json({ accepted: 0, duplicate: 1, rejected: [] }));
    expect((await POST(request(session, "checkout.session.async_payment_succeeded"))).status).toBe(200);
    const ids = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).events[0].id);
    expect(ids[0]).toBe(ids[1]);
  });
  it("requests Stripe retries on transport, HTTP and payload rejection", async () => {
    for (const response of [new Response("down", { status: 503 }), Response.json({ accepted: 0, rejected: [{ error: "bad" }] }), Response.json({})]) {
      fetchMock.mockResolvedValueOnce(response);
      expect((await POST(request())).status).toBe(503);
    }
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect((await POST(request())).status).toBe(503);
    expect((await POST(request())).status).toBe(200);
  });
  it("counts no-cookie purchases as unlinked opaque server identities", async () => {
    await POST(request({ ...session, metadata: { ...session.metadata, pvuv_visitor_id: "" } }));
    const event = JSON.parse(fetchMock.mock.calls[0][1].body).events[0];
    expect(event.visitor_id).toBeUndefined();
    expect(event.user_id).toMatch(/^purchase_/);
  });
  it("does not report from preview or development", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await POST(request())).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
