import Fastify from "fastify";
import sensible from "@fastify/sensible";
import rawBody from "fastify-raw-body";
import { logger } from "./config/logger.js";
import { registerSecurity } from "./plugins/security.js";
import { registerRequestContext } from "./plugins/request-context.js";
import { registerDocs } from "./plugins/docs.js";
import { healthRoutes } from "./modules/health/routes.js";
import { metaRoutes } from "./modules/meta/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { checkoutRoutes } from "./modules/checkout/routes.js";
import { orderRoutes } from "./modules/orders/routes.js";
import { paymentRoutes } from "./modules/payments/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { internalJobRoutes } from "./modules/internal-jobs/routes.js";

export async function buildApp() {
  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(sensible);
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });
  await app.register(registerRequestContext);
  await app.register(registerSecurity);
  await app.register(registerDocs);

  await app.register(healthRoutes);
  await app.register(metaRoutes);
  await app.register(authRoutes);
  await app.register(catalogRoutes);
  await app.register(checkoutRoutes);
  await app.register(orderRoutes);
  await app.register(paymentRoutes);
  await app.register(adminRoutes);
  await app.register(internalJobRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled request error");
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    void reply.status(statusCode).send({
      error: "Internal Server Error",
      requestId: request.requestId,
    });
  });

  return app;
}
