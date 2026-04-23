import bcrypt from "bcryptjs";
import type { FastifyRequest } from "fastify";
import { dbPool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { writeAuditLog } from "../audit/service.js";
import { requestPasswordResetByAccountId } from "../auth/service.js";

export type AdminRole = "admin" | "super_admin";

interface AdminAccountRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_login: Date | null;
}

export async function listAdminAccounts(): Promise<AdminAccountRow[]> {
  const result = await dbPool.query<AdminAccountRow>(
    `select id, email::text as email, name, role, is_active, created_at, updated_at, last_login
     from app.accounts
     order by created_at desc`,
  );
  return result.rows;
}

export async function getAdminAccountById(accountId: string): Promise<AdminAccountRow | null> {
  const result = await dbPool.query<AdminAccountRow>(
    `select id, email::text as email, name, role, is_active, created_at, updated_at, last_login
     from app.accounts
     where id = $1
     limit 1`,
    [accountId],
  );
  return result.rows[0] ?? null;
}

export async function createAdminAccount(
  request: FastifyRequest,
  actorAccountId: string,
  input: { email: string; name: string; role: AdminRole; password: string },
): Promise<{ id: string; email: string; name: string; role: AdminRole; isActive: boolean }> {
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const result = await dbPool.query<{ id: string; email: string; name: string; role: AdminRole; is_active: boolean }>(
    `
      insert into app.accounts (email, password_hash, name, role, is_active)
      values ($1, $2, $3, $4, true)
      returning id, email::text as email, name, role, is_active
    `,
    [input.email, passwordHash, input.name, input.role],
  );
  const created = result.rows[0];

  await writeAuditLog({
    actorType: "admin",
    accountId: actorAccountId,
    source: "admin",
    action: "admin_account_created",
    entityType: "account",
    entityId: created.id,
    summary: `Super admin created ${input.role} account`,
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
    metadata: { createdRole: input.role, createdEmail: created.email },
  });

  return {
    id: created.id,
    email: created.email,
    name: created.name,
    role: created.role,
    isActive: created.is_active,
  };
}

export async function updateAdminRole(
  request: FastifyRequest,
  actorAccountId: string,
  targetAccountId: string,
  role: AdminRole,
): Promise<boolean> {
  if (actorAccountId === targetAccountId) {
    return false;
  }
  const updateResult = await dbPool.query<{ id: string }>(
    `update app.accounts set role = $1 where id = $2 returning id`,
    [role, targetAccountId],
  );
  if (!updateResult.rows[0]) {
    return false;
  }

  await writeAuditLog({
    actorType: "admin",
    accountId: actorAccountId,
    source: "admin",
    action: "admin_role_updated",
    entityType: "account",
    entityId: targetAccountId,
    summary: "Super admin changed account role",
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
    metadata: { newRole: role },
  });
  return true;
}

export async function setAdminActiveState(
  request: FastifyRequest,
  actorAccountId: string,
  targetAccountId: string,
  isActive: boolean,
): Promise<boolean> {
  if (actorAccountId === targetAccountId && !isActive) {
    return false;
  }
  const updateResult = await dbPool.query<{ id: string }>(
    `update app.accounts set is_active = $1 where id = $2 returning id`,
    [isActive, targetAccountId],
  );
  if (!updateResult.rows[0]) {
    return false;
  }
  if (!isActive) {
    await dbPool.query(`update app.admin_refresh_sessions set revoked_at = now() where account_id = $1 and revoked_at is null`, [
      targetAccountId,
    ]);
  }

  await writeAuditLog({
    actorType: "admin",
    accountId: actorAccountId,
    source: "admin",
    action: isActive ? "admin_account_activated" : "admin_account_deactivated",
    entityType: "account",
    entityId: targetAccountId,
    summary: `Super admin ${isActive ? "activated" : "deactivated"} account`,
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
  });
  return true;
}

export async function forcePasswordResetForAdmin(
  request: FastifyRequest,
  actorAccountId: string,
  targetAccountId: string,
): Promise<{ ok: boolean; tokenPreview?: string }> {
  const result = await requestPasswordResetByAccountId(request, targetAccountId, actorAccountId);
  if (!result.issued) {
    return { ok: false };
  }
  await writeAuditLog({
    actorType: "admin",
    accountId: actorAccountId,
    source: "admin",
    action: "admin_forced_password_reset",
    entityType: "account",
    entityId: targetAccountId,
    summary: "Super admin forced password reset",
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
  });
  return { ok: true, tokenPreview: result.tokenPreview };
}

export async function canBootstrapSuperAdmin(): Promise<boolean> {
  const result = await dbPool.query<{ count: string }>(
    `select count(*)::text as count from app.accounts where role = 'super_admin'`,
  );
  return Number(result.rows[0]?.count ?? 0) === 0;
}
