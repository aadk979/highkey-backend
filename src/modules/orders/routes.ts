import type { FastifyPluginAsync } from "fastify";

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/guests/resolve", async () => ({ message: "Not implemented" }));
  app.post("/v1/orders", async () => ({ message: "Not implemented" }));
  app.post("/v1/orders/:orderId/stripe-checkout-session", async () => ({ message: "Not implemented" }));
  app.get("/v1/orders/:orderId/public-status", async () => ({ message: "Not implemented" }));
  app.get("/v1/orders/lookup", async () => ({ message: "Not implemented" }));
};
