import type { FastifyPluginAsync } from "fastify";
import { dbPool } from "../../db/pool.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await dbPool.query("select 1");
      return { status: "ready" };
    } catch (error) {
      app.log.error({ error }, "Readiness check failed");
      return reply.status(503).send({ status: "not_ready" });
    }
  });
};
