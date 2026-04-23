import type { FastifyPluginAsync } from "fastify";

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/products", async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/products/:slug", async () => ({ data: null, message: "Not implemented" }));
  app.get("/v1/promotions/public/active", async () => ({ data: [], message: "Not implemented" }));
};
