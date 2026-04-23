import { dbPool } from "../../db/pool.js";

type AuditActorType = "admin" | "guest" | "system" | "stripe_webhook";
type AuditEntityType =
  | "account"
  | "guest_profile"
  | "product"
  | "promotion"
  | "order"
  | "order_item"
  | "stripe_checkout_session"
  | "stripe_payment_intent"
  | "stripe_refund"
  | "stripe_event"
  | "inventory";

interface WriteAuditLogInput {
  actorType: AuditActorType;
  source: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  accountId?: string;
  guestProfileId?: string;
  stripeEventRecordId?: string;
  orderId?: string;
  requestId?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  await dbPool.query(
    `
      insert into app.audit_logs (
        actor_type, account_id, guest_profile_id, stripe_event_record_id,
        source, action, entity_type, entity_id, order_id, request_id, correlation_id,
        ip_address, user_agent, summary, metadata, success
      )
      values (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15::jsonb, $16
      )
    `,
    [
      input.actorType,
      input.accountId ?? null,
      input.guestProfileId ?? null,
      input.stripeEventRecordId ?? null,
      input.source,
      input.action,
      input.entityType,
      input.entityId,
      input.orderId ?? null,
      input.requestId ?? null,
      input.correlationId ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.summary,
      JSON.stringify(input.metadata ?? {}),
      input.success ?? true,
    ],
  );
}
