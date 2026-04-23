import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  changePassword,
  refreshAdminTokens,
  requestPasswordReset,
  resetPasswordWithToken,
  revokeRefreshToken,
  signInAdmin,
} from "./service.js";
import { requireAdminAuth } from "./guards.js";
import { dbPool } from "../../db/pool.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  const signInSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });
  const refreshSchema = z.object({ refreshToken: z.string().min(32) });
  const forgotSchema = z.object({ email: z.string().email() });
  const resetSchema = z.object({ token: z.string().min(32), newPassword: z.string().min(8) });
  const changeSchema = z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(8) });

  app.post("/v1/auth/admin/sign-in", async (request, reply) => {
    const parsed = signInSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid sign-in payload");
    }

    const authResult = await signInAdmin(request, parsed.data.email, parsed.data.password);
    if (!authResult) {
      return reply.unauthorized("Invalid credentials");
    }

    return {
      accessToken: authResult.tokens.accessToken,
      refreshToken: authResult.tokens.refreshToken,
      refreshExpiresAt: authResult.tokens.refreshExpiresAt.toISOString(),
      admin: {
        id: authResult.accountId,
        email: authResult.email,
        role: authResult.role,
      },
    };
  });

  app.post("/v1/auth/admin/refresh", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid refresh payload");
    }

    const authResult = await refreshAdminTokens(request, parsed.data.refreshToken);
    if (!authResult) {
      return reply.unauthorized("Invalid or expired refresh token");
    }

    return {
      accessToken: authResult.tokens.accessToken,
      refreshToken: authResult.tokens.refreshToken,
      refreshExpiresAt: authResult.tokens.refreshExpiresAt.toISOString(),
      admin: {
        id: authResult.accountId,
        email: authResult.email,
        role: authResult.role,
      },
    };
  });

  app.post("/v1/auth/admin/sign-out", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid sign-out payload");
    }
    await revokeRefreshToken(parsed.data.refreshToken);
    return { message: "Signed out" };
  });

  app.post("/v1/auth/admin/forgot-password", async (request) => {
    const parsed = forgotSchema.safeParse(request.body);
    if (!parsed.success) {
      return { message: "If the account exists, reset instructions were sent" };
    }
    await requestPasswordReset(request, parsed.data.email);
    return { message: "If the account exists, reset instructions were sent" };
  });

  app.post("/v1/auth/admin/reset-password", async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid reset payload");
    }

    const success = await resetPasswordWithToken(request, parsed.data.token, parsed.data.newPassword);
    if (!success) {
      return reply.badRequest("Invalid or expired reset token");
    }
    return { message: "Password reset successful" };
  });

  app.post("/v1/auth/admin/change-password", { preHandler: requireAdminAuth }, async (request, reply) => {
    const parsed = changeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid change-password payload");
    }

    const success = await changePassword(request, request.user.sub, parsed.data.currentPassword, parsed.data.newPassword);
    if (!success) {
      return reply.unauthorized("Current password is invalid");
    }
    return { message: "Password changed successfully" };
  });

  app.get("/v1/auth/me", { preHandler: requireAdminAuth }, async (request) => {
    const result = await dbPool.query<{ id: string; email: string; name: string; role: "admin" | "super_admin"; is_active: boolean }>(
      `select id, email::text as email, name, role, is_active from app.accounts where id = $1 limit 1`,
      [request.user.sub],
    );
    const account = result.rows[0];
    if (!account) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      admin: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        isActive: account.is_active,
      },
    };
  });
};
