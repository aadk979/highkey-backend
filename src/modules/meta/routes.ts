import type { FastifyPluginAsync } from "fastify";

export const metaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/meta/version", async () => ({
    name: "highkey-backend",
    version: "1.0.0",
    runtime: process.version,
  }));
};
