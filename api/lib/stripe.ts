import Stripe from "stripe";
import { env } from "./env";

// Lazy singleton — only instantiated if STRIPE_SECRET_KEY is set
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!env.stripeSecretKey || env.stripeSecretKey.startsWith("dev-insecure")) {
      throw new Error("STRIPE_SECRET_KEY is not configured.");
    }
    _stripe = new Stripe(env.stripeSecretKey, { apiVersion: "2024-11-20.acacia" });
  }
  return _stripe;
}

export const PLANS = {
  trial: {
    name:         "Trial",
    price:        0,
    priceId:      null as null,
    durationDays: 14,
  },
  basic: {
    name:    "Basic",
    price:   99_00, // cents
    priceId: env.stripeBasicPriceId || null,
  },
  pro: {
    name:    "Pro",
    price:   249_00,
    priceId: env.stripeProPriceId || null,
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export async function verifyWebhook(body: string, signature: string): Promise<Stripe.Event> {
  const stripe = getStripe();
  return stripe.webhooks.constructEventAsync(body, signature, env.stripeWebhookSecret);
}
