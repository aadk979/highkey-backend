import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyRequest } from "fastify";
import { dbPool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { writeAuditLog } from "../audit/service.js";

type AdminRole = "admin" | "super_admin";

interface AccountRecord {
  id: string;
  email: string;
  password_hash: string;
  role: AdminRole;
  is_active: boolean;
}

interface SessionRecord {
  id: string;
  account_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export async function signInAdmin(
  request: FastifyRequest,
  email: string,
  password: string,
): Promise<{ accountId: string; role: AdminRole; email: string; tokens: AuthTokens } | null> {
  const accountResult = await dbPool.query<AccountRecord>(
    `select id, email::text as email, password_hash, role, is_active
     from app.accounts
     where email = $1`,
    [email],
  );

  const account = accountResult.rows[0];
  if (!account || !account.is_active) {
    return null;
  }

  const isValidPassword = await bcrypt.compare(password, account.password_hash);
  if (!isValidPassword) {
    await writeAuditLog({
      actorType: "admin",
      accountId: account.id,
      source: "auth",
      action: "sign_in_failed",
      entityType: "account",
      entityId: account.id,
      summary: "Admin sign-in failed due to invalid password",
      requestId: request.requestId,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"]?.toString(),
      success: false,
    });
    return null;
  }

  const tokens = await issueSessionTokens(account.id, account.email, account.role, request);

  await dbPool.query(`update app.accounts set last_login = now() where id = $1`, [account.id]);

  await writeAuditLog({
    actorType: "admin",
    accountId: account.id,
    source: "auth",
    action: "sign_in_success",
    entityType: "account",
    entityId: account.id,
    summary: "Admin sign-in succeeded",
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
  });

  return { accountId: account.id, role: account.role, email: account.email, tokens };
}

export async function refreshAdminTokens(
  request: FastifyRequest,
  refreshToken: string,
): Promise<{ accountId: string; role: AdminRole; email: string; tokens: AuthTokens } | null> {
  const tokenHash = hashToken(refreshToken);
  const sessionResult = await dbPool.query<SessionRecord>(
    `
      select id, account_id, expires_at, revoked_at
      from app.admin_refresh_sessions
      where token_hash = $1
      limit 1
    `,
    [tokenHash],
  );
  const session = sessionResult.rows[0];
  if (!session || session.revoked_at || session.expires_at <= new Date()) {
    return null;
  }

  const accountResult = await dbPool.query<AccountRecord>(
    `select id, email::text as email, password_hash, role, is_active
     from app.accounts where id = $1`,
    [session.account_id],
  );
  const account = accountResult.rows[0];
  if (!account || !account.is_active) {
    return null;
  }

  await dbPool.query(`update app.admin_refresh_sessions set revoked_at = now() where id = $1`, [session.id]);

  const tokens = await issueSessionTokens(account.id, account.email, account.role, request);

  await writeAuditLog({
    actorType: "admin",
    accountId: account.id,
    source: "auth",
    action: "token_refresh",
    entityType: "account",
    entityId: account.id,
    summary: "Admin refreshed session token",
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
  });

  return { accountId: account.id, role: account.role, email: account.email, tokens };
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await dbPool.query(`update app.admin_refresh_sessions set revoked_at = now() where token_hash = $1`, [tokenHash]);
}

export async function requestPasswordReset(request: FastifyRequest, email: string): Promise<void> {
  const accountResult = await dbPool.query<{ id: string; is_active: boolean }>(
    `select id, is_active from app.accounts where email = $1`,
    [email],
  );
  const account = accountResult.rows[0];

  if (!account || !account.is_active) {
    return;
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await dbPool.query(
    `
      insert into app.admin_password_reset_tokens (account_id, token_hash, expires_at, requested_ip, requested_user_agent)
      values ($1, $2, $3, $4, $5)
    `,
    [account.id, tokenHash, expiresAt, request.ip, request.headers["user-agent"]?.toString() ?? null],
  );

  await writeAuditLog({
    actorType: "admin",
    accountId: account.id,
    source: "auth",
    action: "password_reset_requested",
    entityType: "account",
    entityId: account.id,
    summary: "Admin password reset requested",
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
  });

  request.log.info({ accountId: account.id, token: rawToken }, "Password reset token generated");
}

export async function resetPasswordWithToken(
  request: FastifyRequest,
  resetToken: string,
  newPassword: string,
): Promise<boolean> {
  const tokenHash = hashToken(resetToken);
  const tokenResult = await dbPool.query<{ id: string; account_id: string }>(
    `
      select id, account_id
      from app.admin_password_reset_tokens
      where token_hash = $1
        and consumed_at is null
        and expires_at > now()
      limit 1
    `,
    [tokenHash],
  );
  const tokenRecord = tokenResult.rows[0];
  if (!tokenRecord) {
    return false;
  }

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);

  const client = await dbPool.connect();
  try {
    await client.query("begin");
    await client.query(`update app.accounts set password_hash = $1 where id = $2`, [passwordHash, tokenRecord.account_id]);
    await client.query(`update app.admin_password_reset_tokens set consumed_at = now() where id = $1`, [tokenRecord.id]);
    await client.query(`update app.admin_refresh_sessions set revoked_at = now() where account_id = $1 and revoked_at is null`, [
      tokenRecord.account_id,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({
    actorType: "admin",
    accountId: tokenRecord.account_id,
    source: "auth",
    action: "password_reset_completed",
    entityType: "account",
    entityId: tokenRecord.account_id,
    summary: "Admin password reset completed",
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
  });

  return true;
}

export async function changePassword(
  request: FastifyRequest,
  accountId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const accountResult = await dbPool.query<AccountRecord>(
    `select id, email::text as email, password_hash, role, is_active
     from app.accounts where id = $1`,
    [accountId],
  );
  const account = accountResult.rows[0];
  if (!account) {
    return false;
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, account.password_hash);
  if (!isCurrentValid) {
    return false;
  }

  const newPasswordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await dbPool.query(`update app.accounts set password_hash = $1 where id = $2`, [newPasswordHash, accountId]);
  await dbPool.query(`update app.admin_refresh_sessions set revoked_at = now() where account_id = $1 and revoked_at is null`, [accountId]);

  await writeAuditLog({
    actorType: "admin",
    accountId,
    source: "auth",
    action: "password_changed",
    entityType: "account",
    entityId: accountId,
    summary: "Admin changed own password",
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"]?.toString(),
  });

  return true;
}

async function issueSessionTokens(
  accountId: string,
  email: string,
  role: AdminRole,
  request: FastifyRequest,
): Promise<AuthTokens> {
  const accessToken = await request.server.jwt.sign(
    { sub: accountId, email, role },
    { expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m` },
  );
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const refreshTokenHash = hashToken(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await dbPool.query(
    `
      insert into app.admin_refresh_sessions (account_id, token_hash, user_agent, ip_address, expires_at, last_used_at)
      values ($1, $2, $3, $4, $5, now())
    `,
    [accountId, refreshTokenHash, request.headers["user-agent"]?.toString() ?? null, request.ip, refreshExpiresAt],
  );

  return {
    accessToken,
    refreshToken,
    refreshExpiresAt,
  };
}

function hashToken(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
