import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAdminAuth, requireSuperAdmin } from "../auth/guards.js";
import {
  canBootstrapSuperAdmin,
  createAdminAccount,
  forcePasswordResetForAdmin,
  getAdminAccountById,
  listAdminAccounts,
  setAdminActiveState,
  updateAdminRole,
} from "./service.js";
import { env } from "../../config/env.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const createAdminSchema = z.object({
    email: z.string().email(),
    name: z.string().trim().min(1).max(255),
    role: z.enum(["admin", "super_admin"]).default("admin"),
    password: z.string().min(12).max(128),
  });
  const roleSchema = z.object({
    role: z.enum(["admin", "super_admin"]),
  });
  const activationSchema = z.object({
    isActive: z.boolean(),
  });
  const bootstrapSchema = z.object({
    bootstrapKey: z.string().min(16),
    email: z.string().email(),
    name: z.string().trim().min(1).max(255),
    password: z.string().min(12).max(128),
  });

  app.get("/v1/admin/orders", { preHandler: requireAdminAuth }, async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/orders/:orderId", { preHandler: requireAdminAuth }, async () => ({ data: null, message: "Not implemented" }));
  app.patch("/v1/admin/orders/:orderId/status", { preHandler: requireAdminAuth }, async () => ({ message: "Not implemented" }));
  app.get("/v1/admin/guest-profiles", { preHandler: requireAdminAuth }, async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/audit-logs", { preHandler: requireAdminAuth }, async () => ({ data: [], message: "Not implemented" }));
  app.get("/v1/admin/stripe/events", { preHandler: requireAdminAuth }, async () => ({ data: [], message: "Not implemented" }));

  app.post("/v1/super-admin/bootstrap", async (request, reply) => {
    if (!env.SUPER_ADMIN_BOOTSTRAP_KEY) {
      return reply.notFound();
    }
    const parsed = bootstrapSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid bootstrap payload");
    }
    if (parsed.data.bootstrapKey !== env.SUPER_ADMIN_BOOTSTRAP_KEY) {
      return reply.unauthorized("Invalid bootstrap key");
    }
    const canBootstrap = await canBootstrapSuperAdmin();
    if (!canBootstrap) {
      return reply.conflict("Bootstrap disabled: super admin already exists");
    }
    const created = await createAdminAccount(request, "00000000-0000-0000-0000-000000000000", {
      email: parsed.data.email,
      name: parsed.data.name,
      role: "super_admin",
      password: parsed.data.password,
    });
    return { message: "Super admin bootstrapped", admin: created };
  });

  app.get("/v1/admin/accounts", { preHandler: requireSuperAdmin }, async () => {
    const accounts = await listAdminAccounts();
    return {
      data: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        role: a.role,
        isActive: a.is_active,
        lastLogin: a.last_login,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      })),
    };
  });

  app.get("/v1/admin/accounts/:accountId", { preHandler: requireSuperAdmin }, async (request, reply) => {
    const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId);
    const account = await getAdminAccountById(accountId);
    if (!account) {
      return reply.notFound("Account not found");
    }
    return {
      data: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        isActive: account.is_active,
        lastLogin: account.last_login,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      },
    };
  });

  app.post("/v1/super-admin/admins", { preHandler: requireSuperAdmin }, async (request, reply) => {
    const parsed = createAdminSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid admin creation payload");
    }
    const created = await createAdminAccount(request, request.user.sub, parsed.data);
    return reply.status(201).send({ admin: created });
  });

  app.patch("/v1/super-admin/admins/:adminId/role", { preHandler: requireSuperAdmin }, async (request, reply) => {
    const adminId = z.string().uuid().parse((request.params as { adminId: string }).adminId);
    const parsed = roleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid role payload");
    }
    const ok = await updateAdminRole(request, request.user.sub, adminId, parsed.data.role);
    if (!ok) {
      return reply.badRequest("Unable to update role");
    }
    return { message: "Role updated" };
  });

  app.patch("/v1/super-admin/admins/:adminId/activate", { preHandler: requireSuperAdmin }, async (request, reply) => {
    const adminId = z.string().uuid().parse((request.params as { adminId: string }).adminId);
    const parsed = activationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid activation payload");
    }
    const ok = await setAdminActiveState(request, request.user.sub, adminId, parsed.data.isActive);
    if (!ok) {
      return reply.badRequest("Unable to update active state");
    }
    return { message: parsed.data.isActive ? "Account activated" : "Account deactivated" };
  });

  app.post("/v1/super-admin/admins/:adminId/send-reset", { preHandler: requireSuperAdmin }, async (request, reply) => {
    const adminId = z.string().uuid().parse((request.params as { adminId: string }).adminId);
    const result = await forcePasswordResetForAdmin(request, request.user.sub, adminId);
    if (!result.ok) {
      return reply.badRequest("Unable to issue reset token");
    }
    return {
      message: "Reset workflow issued",
      tokenPreview: result.tokenPreview,
    };
  });
};
