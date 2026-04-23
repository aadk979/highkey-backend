import type { FastifyPluginAsync } from "fastify";
import { env } from "../../config/env.js";
import { stripe } from "../../lib/stripe.js";

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/payments/stripe/checkout-sessions", async () => ({ message: "Not implemented" }));

  app.post("/v1/payments/stripe/webhook", { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    if (!signature || !request.rawBody) {
      return reply.status(400).send({ message: "Missing Stripe signature or raw body" });
    }

    try {
      stripe.webhooks.constructEvent(request.rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
      return reply.status(200).send({ received: true });
    } catch (error) {
      app.log.error({ error }, "Stripe webhook signature verification failed");
      return reply.status(400).send({ message: "Invalid webhook signature" });
    }
  });
};
