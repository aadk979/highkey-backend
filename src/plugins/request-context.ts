import crypto from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
  }
}

const requestContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (request, reply) => {
    const requestId = request.headers["x-request-id"]?.toString() ?? crypto.randomUUID();
    request.requestId = requestId;
    reply.header("x-request-id", requestId);
  });
};

export const registerRequestContext = fp(requestContextPlugin);
