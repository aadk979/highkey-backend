import type { FastifyPluginAsync } from "fastify";

export const internalJobRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/internal/jobs/reconcile-stripe", async () => ({ message: "Not implemented" }));
  app.post("/v1/internal/jobs/retry-webhooks", async () => ({ message: "Not implemented" }));
  app.post("/v1/internal/jobs/expire-pending-orders", async () => ({ message: "Not implemented" }));
};
