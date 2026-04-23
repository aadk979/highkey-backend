import type { FastifyPluginAsync } from "fastify";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/admin/orders", async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/orders/:orderId", async () => ({ data: null, message: "Not implemented" }));
  app.patch("/v1/admin/orders/:orderId/status", async () => ({ message: "Not implemented" }));
  app.get("/v1/admin/guest-profiles", async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/audit-logs", async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/stripe/events", async () => ({ data: [], message: "Not implemented" }));
};
