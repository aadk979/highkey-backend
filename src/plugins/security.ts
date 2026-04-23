import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { env } from "../config/env.js";

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet);
  await app.register(cors, {
    origin: env.corsOrigins,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  });
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    cookie: {
      cookieName: "access_token",
      signed: false,
    },
  });
}
