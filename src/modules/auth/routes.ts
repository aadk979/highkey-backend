import type { FastifyPluginAsync } from "fastify";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/auth/admin/sign-in", async () => ({ message: "Not implemented" }));
  app.post("/v1/auth/admin/refresh", async () => ({ message: "Not implemented" }));
  app.post("/v1/auth/admin/sign-out", async () => ({ message: "Not implemented" }));
  app.post("/v1/auth/admin/forgot-password", async () => ({
    message: "If the account exists, reset instructions were sent",
  }));
  app.post("/v1/auth/admin/reset-password", async () => ({ message: "Not implemented" }));
  app.get("/v1/auth/me", async () => ({ message: "Not implemented" }));
};
