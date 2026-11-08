import { requiredEnv } from "../server/config.js";
import { publicErrorResponse } from "../server/errors.js";
import { getStripe } from "../server/stripe-client.js";
import {
  fulfillCheckoutSession,
  markStripePaymentIntentFailed,
  markStripeSessionState,
} from "../server/stripe-fulfillment.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed." },
        { status: 405, headers: { Allow: "POST" } },
      );
    }

    try {
      const signature = request.headers.get("stripe-signature");
      if (!signature) {
        return Response.json(
          { error: "Missing Stripe signature." },
          { status: 400 },
        );
      }

      const rawBody = await request.text();
      let event;
      try {
        event = getStripe().webhooks.constructEvent(
          rawBody,
          signature,
          requiredEnv("STRIPE_WEBHOOK_SECRET"),
        );
      } catch (error) {
        return Response.json(
          { error: `Stripe webhook signature verification failed: ${error.message}` },
          { status: 400 },
        );
      }

      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          await fulfillCheckoutSession(event.data.object);
          break;
        case "checkout.session.async_payment_failed":
          await markStripeSessionState(event.data.object, "failed");
          break;
        case "checkout.session.expired":
          await markStripeSessionState(event.data.object, "cancelled");
          break;
        case "payment_intent.payment_failed":
          await markStripePaymentIntentFailed(event.data.object);
          break;
        default:
          break;
      }

      return Response.json({ received: true });
    } catch (error) {
      return publicErrorResponse(error);
    }
  },
};
