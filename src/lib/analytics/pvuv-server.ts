import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { PRO_PRODUCT } from "@/lib/pro/config";

const VISITOR_ID = /^[a-zA-Z0-9_-]{8,128}$/;
export function pvuvVisitorId(request: Request): string | undefined {
  const value = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim()).find((part) => part.startsWith("_pv_id="))?.slice(7);
  return value && VISITOR_ID.test(value) ? value : undefined;
}

/** Retry-safe: Stripe may deliver several event types for the same session. */
export async function reportProPurchase(session: Stripe.Checkout.Session): Promise<boolean> {
  if (process.env.VERCEL_ENV !== "production" || process.env.NODE_ENV !== "production" ||
    !session.livemode || session.mode !== "payment" || session.payment_status !== "paid" ||
    session.metadata?.product !== PRO_PRODUCT) return true;
  const site = process.env.PVUV_SITE;
  const token = process.env.PVUV_INGEST_TOKEN;
  if (!site || !token) return false;
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total! < 0 || session.currency !== "usd") return false;
  const id = "purchase_" + createHash("sha256").update(session.id).digest("hex").slice(0, 48);
  const visitor = session.metadata?.pvuv_visitor_id;
  const identity = visitor && VISITOR_ID.test(visitor)
    ? { visitor_id: visitor }
    // A purchase-scoped opaque identity counts revenue without inventing a
    // browser association when cookies were blocked. Never identify it client-side.
    : { user_id: id };
  try {
    const response = await fetch(`https://api.pvuv.ai/v1/sites/${encodeURIComponent(site)}/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ events: [{
        name: "purchase", id, ...identity, revenue: session.amount_total! / 100,
        currency: "USD", props: { product: PRO_PRODUCT },
      }] }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return (result.accepted === 1 || result.duplicate === 1) &&
      Array.isArray(result.rejected) && result.rejected.length === 0;
  } catch { return false; }
}
