import type { FastifyPluginAsync } from "fastify";

export const checkoutRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/checkout/quote", async () => ({ message: "Not implemented" }));
  app.get("/v1/checkout/config", async () => ({ message: "Not implemented" }));
};
