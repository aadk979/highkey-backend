import type { FastifyReply, FastifyRequest } from "fastify";

export interface AdminJwtPayload {
  sub: string;
  email: string;
  role: "admin" | "super_admin";
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AdminJwtPayload;
    user: AdminJwtPayload;
  }
}

export async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify<AdminJwtPayload>();
  } catch {
    await reply.unauthorized("Unauthorized");
  }
}

export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAdminAuth(request, reply);
  if (reply.sent) {
    return;
  }
  if (request.user.role !== "super_admin") {
    await reply.forbidden("Requires super_admin role");
  }
}
