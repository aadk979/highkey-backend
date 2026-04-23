import type { FastifyPluginAsync } from "fastify";
import { requireAdminAuth, requireSuperAdmin } from "../auth/guards.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/admin/orders", { preHandler: requireAdminAuth }, async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/orders/:orderId", { preHandler: requireAdminAuth }, async () => ({ data: null, message: "Not implemented" }));
  app.patch("/v1/admin/orders/:orderId/status", { preHandler: requireAdminAuth }, async () => ({ message: "Not implemented" }));
  app.get("/v1/admin/guest-profiles", { preHandler: requireAdminAuth }, async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/audit-logs", { preHandler: requireAdminAuth }, async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/stripe/events", { preHandler: requireAdminAuth }, async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/accounts", { preHandler: requireSuperAdmin }, async () => ({ data: [], message: "Not implemented" }));
};
