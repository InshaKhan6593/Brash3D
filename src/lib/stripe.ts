import "server-only"

import Stripe from "stripe"

let stripeClient: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  const liveMode = process.env.STRIPE_MODE === "live"
  const expectedPrefix = liveMode ? "sk_live_" : "sk_test_"
  if (!key || !key.startsWith(expectedPrefix)) {
    throw new Error(liveMode ? "STRIPE_LIVE_MODE_NOT_CONFIGURED" : "STRIPE_TEST_MODE_NOT_CONFIGURED")
  }
  stripeClient ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 })
  return stripeClient
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !secret.startsWith("whsec_")) {
    throw new Error("STRIPE_WEBHOOK_NOT_CONFIGURED")
  }
  return secret
}
