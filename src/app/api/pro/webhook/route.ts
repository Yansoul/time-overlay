import { createProStripeConfig } from "@/lib/pro/config";
import { reportProPurchase } from "@/lib/analytics/pvuv-server";
import type Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const config = createProStripeConfig();
  const secret = process.env.STRIPE_PRO_WEBHOOK_SECRET;
  if (!config || !secret) return Response.json({ error: "not_configured" }, { status: 503 });
  let event: Stripe.Event;
  try {
    event = config.stripe.webhooks.constructEvent(
      await request.text(), request.headers.get("stripe-signature") ?? "", secret,
    );
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }
  if (event.livemode && (event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded")) {
    if (!await reportProPurchase(event.data.object)) {
      // Stripe retries non-2xx deliveries. A swallowed analytics error here
      // would permanently lose purchases from customers who never return.
      return Response.json({ error: "reporting_unavailable" }, { status: 503 });
    }
  }
  return Response.json({ received: true });
}
