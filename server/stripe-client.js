import Stripe from "stripe";
import { requiredEnv } from "./config.js";

let stripeClient;

export function getStripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      appInfo: {
        name: "Harla Hotel Room Booking",
        version: "1.0.0",
      },
    });
  }

  return stripeClient;
}
