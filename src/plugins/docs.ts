import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export async function registerDocs(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "HighKey Backend API",
        version: "1.0.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
}
