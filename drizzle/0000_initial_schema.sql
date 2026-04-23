BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TYPE app.admin_role AS ENUM ('admin', 'super_admin');
CREATE TYPE app.fulfillment_method AS ENUM ('self_collect', 'delivery');
CREATE TYPE app.order_status AS ENUM ('received', 'preparing', 'shipped_out', 'delivered', 'collection_scheduled', 'cancelled', 'refunded', 'collected');
CREATE TYPE app.payment_status AS ENUM ('pending', 'requires_action', 'paid', 'failed', 'cancelled', 'partially_refunded', 'refunded');
CREATE TYPE app.payment_provider AS ENUM ('stripe');
CREATE TYPE app.promotion_limit_by AS ENUM ('unlimited', 'phone_number');
CREATE TYPE app.product_type AS ENUM ('accessory', 'base');
CREATE TYPE app.stripe_mode AS ENUM ('test', 'live');
CREATE TYPE app.stripe_event_processing_status AS ENUM ('received', 'processing', 'processed', 'failed', 'ignored');
CREATE TYPE app.audit_actor_type AS ENUM ('admin', 'guest', 'system', 'stripe_webhook');
CREATE TYPE app.audit_entity_type AS ENUM ('account', 'guest_profile', 'product', 'promotion', 'order', 'order_item', 'stripe_checkout_session', 'stripe_payment_intent', 'stripe_refund', 'stripe_event', 'inventory');

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE app.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name varchar(255) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login timestamptz,
  role app.admin_role NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_accounts_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT chk_accounts_password_hash_not_blank CHECK (btrim(password_hash) <> '')
);

CREATE TABLE app.admin_refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip_address inet,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_admin_refresh_sessions_token_hash_not_blank CHECK (btrim(token_hash) <> ''),
  CONSTRAINT chk_admin_refresh_sessions_expires_after_create CHECK (expires_at > created_at)
);

CREATE TABLE app.admin_password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES app.accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  requested_ip inet,
  requested_user_agent text,
  created_by_account_id uuid REFERENCES app.accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_admin_password_reset_tokens_token_hash_not_blank CHECK (btrim(token_hash) <> ''),
  CONSTRAINT chk_admin_password_reset_tokens_expires_after_create CHECK (expires_at > created_at),
  CONSTRAINT chk_admin_password_reset_tokens_consumed_after_create CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE TABLE app.guest_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  country_code varchar(8) NOT NULL,
  phone_number varchar(32) NOT NULL,
  full_name varchar(255),
  stripe_customer_id varchar(255) UNIQUE,
  marketing_consent boolean NOT NULL DEFAULT false,
  last_order_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_guest_profiles_email_not_blank CHECK (btrim(email::text) <> ''),
  CONSTRAINT chk_guest_profiles_country_code_not_blank CHECK (btrim(country_code) <> ''),
  CONSTRAINT chk_guest_profiles_phone_number_not_blank CHECK (btrim(phone_number) <> ''),
  CONSTRAINT chk_guest_profiles_full_name_not_blank CHECK (full_name IS NULL OR btrim(full_name) <> '')
);

CREATE TABLE app.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  slug varchar(255) NOT NULL UNIQUE,
  description text,
  base_price_cents integer NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'SGD',
  is_active boolean NOT NULL DEFAULT true,
  is_customizable boolean NOT NULL DEFAULT false,
  available_stock integer NOT NULL DEFAULT 0,
  product_type app.product_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_products_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT chk_products_slug_not_blank CHECK (btrim(slug) <> ''),
  CONSTRAINT chk_products_currency_code_upper CHECK (currency_code = upper(currency_code)),
  CONSTRAINT chk_products_base_price_non_negative CHECK (base_price_cents >= 0),
  CONSTRAINT chk_products_available_stock_non_negative CHECK (available_stock >= 0)
);

CREATE TABLE app.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES app.products(id) ON DELETE RESTRICT,
  discount_percentage numeric(5,2),
  discount_value_cents integer,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  limit_by app.promotion_limit_by NOT NULL DEFAULT 'unlimited',
  usage_limit integer,
  independent_use boolean NOT NULL DEFAULT false,
  store_wide boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_promotions_date_range CHECK (end_date >= start_date),
  CONSTRAINT chk_promotions_discount_percentage_range CHECK (discount_percentage IS NULL OR (discount_percentage >= 0 AND discount_percentage <= 100)),
  CONSTRAINT chk_promotions_discount_value_non_negative CHECK (discount_value_cents IS NULL OR discount_value_cents >= 0),
  CONSTRAINT chk_promotions_single_discount_mode CHECK (
    (discount_percentage IS NOT NULL AND discount_value_cents IS NULL)
    OR
    (discount_percentage IS NULL AND discount_value_cents IS NOT NULL)
  ),
  CONSTRAINT chk_promotions_scope CHECK (
    (store_wide = true AND product_id IS NULL)
    OR
    (store_wide = false AND product_id IS NOT NULL)
  ),
  CONSTRAINT chk_promotions_usage_limit_non_negative CHECK (usage_limit IS NULL OR usage_limit >= 0),
  CONSTRAINT chk_promotions_limit_rule CHECK (
    (limit_by = 'unlimited' AND usage_limit IS NULL)
    OR
    (limit_by = 'phone_number' AND usage_limit IS NOT NULL)
  )
);

CREATE TABLE app.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_profile_id uuid NOT NULL REFERENCES app.guest_profiles(id) ON DELETE RESTRICT,
  customer_name varchar(255) NOT NULL,
  customer_email citext NOT NULL,
  country_code varchar(8) NOT NULL,
  customer_phone_number varchar(32) NOT NULL,
  fulfillment_method app.fulfillment_method NOT NULL,
  delivery_address text,
  self_collect_location varchar(255),
  subtotal_cents integer NOT NULL DEFAULT 0,
  discount_total_cents integer NOT NULL DEFAULT 0,
  tax_total_cents integer NOT NULL DEFAULT 0,
  shipping_total_cents integer NOT NULL DEFAULT 0,
  grand_total_cents integer NOT NULL DEFAULT 0,
  customization_layout_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  promotion_applied boolean NOT NULL DEFAULT false,
  order_status app.order_status NOT NULL DEFAULT 'received',
  payment_status app.payment_status NOT NULL DEFAULT 'pending',
  payment_provider app.payment_provider NOT NULL DEFAULT 'stripe',
  customer_note text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_orders_customer_name_not_blank CHECK (btrim(customer_name) <> ''),
  CONSTRAINT chk_orders_customer_email_not_blank CHECK (btrim(customer_email::text) <> ''),
  CONSTRAINT chk_orders_country_code_not_blank CHECK (btrim(country_code) <> ''),
  CONSTRAINT chk_orders_customer_phone_not_blank CHECK (btrim(customer_phone_number) <> ''),
  CONSTRAINT chk_orders_subtotal_non_negative CHECK (subtotal_cents >= 0),
  CONSTRAINT chk_orders_discount_total_non_negative CHECK (discount_total_cents >= 0),
  CONSTRAINT chk_orders_tax_total_non_negative CHECK (tax_total_cents >= 0),
  CONSTRAINT chk_orders_shipping_total_non_negative CHECK (shipping_total_cents >= 0),
  CONSTRAINT chk_orders_grand_total_non_negative CHECK (grand_total_cents >= 0),
  CONSTRAINT chk_orders_grand_total CHECK (grand_total_cents = subtotal_cents - discount_total_cents + tax_total_cents + shipping_total_cents),
  CONSTRAINT chk_orders_fulfillment_fields CHECK (
    (fulfillment_method = 'delivery' AND delivery_address IS NOT NULL AND self_collect_location IS NULL)
    OR
    (fulfillment_method = 'self_collect' AND self_collect_location IS NOT NULL AND delivery_address IS NULL)
  ),
  CONSTRAINT chk_orders_paid_at_for_paid_status CHECK (
    payment_status <> 'paid' OR paid_at IS NOT NULL
  )
);

CREATE TABLE app.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE RESTRICT,
  applied_promotion_id uuid REFERENCES app.promotions(id) ON DELETE SET NULL,
  snapshot_name varchar(255) NOT NULL,
  snapshot_slug varchar(255) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price_cents integer NOT NULL,
  discount_total_cents integer NOT NULL DEFAULT 0,
  line_total_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_order_items_snapshot_name_not_blank CHECK (btrim(snapshot_name) <> ''),
  CONSTRAINT chk_order_items_snapshot_slug_not_blank CHECK (btrim(snapshot_slug) <> ''),
  CONSTRAINT chk_order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT chk_order_items_unit_price_non_negative CHECK (unit_price_cents >= 0),
  CONSTRAINT chk_order_items_discount_non_negative CHECK (discount_total_cents >= 0),
  CONSTRAINT chk_order_items_line_total_non_negative CHECK (line_total_cents >= 0),
  CONSTRAINT chk_order_items_line_total CHECK (line_total_cents = (quantity * unit_price_cents) - discount_total_cents)
);

CREATE TABLE app.stripe_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_checkout_session_id varchar(255) NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  guest_profile_id uuid NOT NULL REFERENCES app.guest_profiles(id) ON DELETE RESTRICT,
  mode app.stripe_mode NOT NULL,
  checkout_status varchar(64),
  payment_status varchar(64),
  client_reference_id varchar(255),
  stripe_customer_id varchar(255),
  customer_email_prefill citext,
  collected_name varchar(255),
  collected_email citext,
  collected_phone varchar(32),
  currency_code char(3),
  amount_subtotal_cents integer,
  amount_total_cents integer,
  expires_at timestamptz,
  completed_at timestamptz,
  success_url text,
  cancel_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_stripe_checkout_sessions_id_not_blank CHECK (btrim(stripe_checkout_session_id) <> ''),
  CONSTRAINT chk_stripe_checkout_sessions_amount_subtotal_non_negative CHECK (amount_subtotal_cents IS NULL OR amount_subtotal_cents >= 0),
  CONSTRAINT chk_stripe_checkout_sessions_amount_total_non_negative CHECK (amount_total_cents IS NULL OR amount_total_cents >= 0),
  CONSTRAINT chk_stripe_checkout_sessions_currency_upper CHECK (currency_code IS NULL OR currency_code = upper(currency_code))
);

CREATE TABLE app.stripe_payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_payment_intent_id varchar(255) NOT NULL UNIQUE,
  stripe_checkout_session_id uuid REFERENCES app.stripe_checkout_sessions(id) ON DELETE SET NULL,
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  mode app.stripe_mode NOT NULL,
  stripe_status varchar(64) NOT NULL,
  amount_cents integer NOT NULL,
  amount_received_cents integer NOT NULL DEFAULT 0,
  amount_capturable_cents integer NOT NULL DEFAULT 0,
  currency_code char(3) NOT NULL,
  stripe_customer_id varchar(255),
  latest_charge_id varchar(255),
  receipt_email citext,
  payment_method_type varchar(64),
  succeeded_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_stripe_payment_intents_id_not_blank CHECK (btrim(stripe_payment_intent_id) <> ''),
  CONSTRAINT chk_stripe_payment_intents_status_not_blank CHECK (btrim(stripe_status) <> ''),
  CONSTRAINT chk_stripe_payment_intents_amount_non_negative CHECK (amount_cents >= 0),
  CONSTRAINT chk_stripe_payment_intents_amount_received_non_negative CHECK (amount_received_cents >= 0),
  CONSTRAINT chk_stripe_payment_intents_amount_capturable_non_negative CHECK (amount_capturable_cents >= 0),
  CONSTRAINT chk_stripe_payment_intents_currency_upper CHECK (currency_code = upper(currency_code))
);

CREATE TABLE app.stripe_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_refund_id varchar(255) NOT NULL UNIQUE,
  stripe_payment_intent_id uuid REFERENCES app.stripe_payment_intents(id) ON DELETE SET NULL,
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  stripe_status varchar(64) NOT NULL,
  stripe_reason varchar(64),
  failure_reason varchar(255),
  amount_cents integer NOT NULL,
  currency_code char(3) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_stripe_refunds_id_not_blank CHECK (btrim(stripe_refund_id) <> ''),
  CONSTRAINT chk_stripe_refunds_status_not_blank CHECK (btrim(stripe_status) <> ''),
  CONSTRAINT chk_stripe_refunds_amount_non_negative CHECK (amount_cents >= 0),
  CONSTRAINT chk_stripe_refunds_currency_upper CHECK (currency_code = upper(currency_code))
);

CREATE TABLE app.stripe_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id varchar(255) NOT NULL UNIQUE,
  mode app.stripe_mode NOT NULL,
  event_type varchar(255) NOT NULL,
  api_version varchar(64),
  stripe_object_type varchar(64),
  stripe_object_id varchar(255),
  related_order_id uuid REFERENCES app.orders(id) ON DELETE SET NULL,
  related_checkout_session_id uuid REFERENCES app.stripe_checkout_sessions(id) ON DELETE SET NULL,
  related_payment_intent_id uuid REFERENCES app.stripe_payment_intents(id) ON DELETE SET NULL,
  related_refund_id uuid REFERENCES app.stripe_refunds(id) ON DELETE SET NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  processing_status app.stripe_event_processing_status NOT NULL DEFAULT 'received',
  stripe_created_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  request_id varchar(255),
  idempotency_key varchar(255),
  error_message text,
  payload jsonb NOT NULL,
  CONSTRAINT chk_stripe_events_id_not_blank CHECK (btrim(stripe_event_id) <> ''),
  CONSTRAINT chk_stripe_events_event_type_not_blank CHECK (btrim(event_type) <> ''),
  CONSTRAINT chk_stripe_events_processed_after_received CHECK (processed_at IS NULL OR processed_at >= received_at)
);

CREATE TABLE app.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type app.audit_actor_type NOT NULL,
  account_id uuid REFERENCES app.accounts(id) ON DELETE SET NULL,
  guest_profile_id uuid REFERENCES app.guest_profiles(id) ON DELETE SET NULL,
  stripe_event_record_id uuid REFERENCES app.stripe_events(id) ON DELETE SET NULL,
  source varchar(64) NOT NULL,
  action varchar(128) NOT NULL,
  entity_type app.audit_entity_type NOT NULL,
  entity_id varchar(255) NOT NULL,
  order_id uuid REFERENCES app.orders(id) ON DELETE SET NULL,
  request_id varchar(255),
  correlation_id varchar(255),
  ip_address inet,
  user_agent text,
  summary text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  success boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_audit_logs_source_not_blank CHECK (btrim(source) <> ''),
  CONSTRAINT chk_audit_logs_action_not_blank CHECK (btrim(action) <> ''),
  CONSTRAINT chk_audit_logs_entity_id_not_blank CHECK (btrim(entity_id) <> ''),
  CONSTRAINT chk_audit_logs_summary_not_blank CHECK (btrim(summary) <> ''),
  CONSTRAINT chk_audit_logs_actor_refs CHECK (
    (actor_type = 'admin' AND account_id IS NOT NULL)
    OR (actor_type = 'guest' AND guest_profile_id IS NOT NULL)
    OR (actor_type = 'stripe_webhook' AND stripe_event_record_id IS NOT NULL)
    OR (actor_type = 'system')
  )
);

CREATE TABLE app.audit_log_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_log_id uuid NOT NULL REFERENCES app.audit_logs(id) ON DELETE CASCADE,
  field_name varchar(255) NOT NULL,
  old_value text,
  new_value text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_audit_log_changes_field_name_not_blank CHECK (btrim(field_name) <> '')
);

CREATE UNIQUE INDEX uq_guest_profiles_contact ON app.guest_profiles (email, country_code, phone_number);
CREATE INDEX idx_guest_profiles_email ON app.guest_profiles (email);
CREATE INDEX idx_guest_profiles_country_phone ON app.guest_profiles (country_code, phone_number);
CREATE INDEX idx_products_name ON app.products (name);
CREATE INDEX idx_products_product_type ON app.products (product_type);
CREATE INDEX idx_products_is_active ON app.products (is_active);
CREATE INDEX idx_promotions_product_id ON app.promotions (product_id);
CREATE INDEX idx_promotions_start_date ON app.promotions (start_date);
CREATE INDEX idx_promotions_end_date ON app.promotions (end_date);
CREATE INDEX idx_promotions_store_wide_date ON app.promotions (store_wide, start_date, end_date);
CREATE INDEX idx_orders_guest_profile_id ON app.orders (guest_profile_id);
CREATE INDEX idx_orders_customer_email ON app.orders (customer_email);
CREATE INDEX idx_orders_customer_phone ON app.orders (customer_phone_number);
CREATE INDEX idx_orders_order_status ON app.orders (order_status);
CREATE INDEX idx_orders_payment_status ON app.orders (payment_status);
CREATE INDEX idx_orders_created_at ON app.orders (created_at DESC);
CREATE INDEX idx_orders_open_queue ON app.orders (order_status, payment_status, created_at DESC)
  WHERE order_status IN ('received', 'preparing', 'collection_scheduled') AND payment_status IN ('pending', 'paid');
CREATE INDEX idx_order_items_order_id ON app.order_items (order_id);
CREATE INDEX idx_order_items_product_id ON app.order_items (product_id);
CREATE INDEX idx_order_items_applied_promotion_id ON app.order_items (applied_promotion_id);
CREATE INDEX idx_order_items_order_product ON app.order_items (order_id, product_id);
CREATE INDEX idx_accounts_is_active ON app.accounts (is_active);
CREATE INDEX idx_accounts_email_active ON app.accounts (email, is_active);
CREATE INDEX idx_admin_refresh_sessions_account_id ON app.admin_refresh_sessions (account_id);
CREATE INDEX idx_admin_refresh_sessions_expires_at ON app.admin_refresh_sessions (expires_at);
CREATE INDEX idx_admin_refresh_sessions_revoked_at ON app.admin_refresh_sessions (revoked_at);
CREATE INDEX idx_admin_password_reset_tokens_account_id ON app.admin_password_reset_tokens (account_id);
CREATE INDEX idx_admin_password_reset_tokens_expires_at ON app.admin_password_reset_tokens (expires_at);
CREATE INDEX idx_admin_password_reset_tokens_consumed_at ON app.admin_password_reset_tokens (consumed_at);
CREATE INDEX idx_stripe_checkout_sessions_order_id ON app.stripe_checkout_sessions (order_id);
CREATE INDEX idx_stripe_checkout_sessions_guest_profile_id ON app.stripe_checkout_sessions (guest_profile_id);
CREATE INDEX idx_stripe_checkout_sessions_customer_id ON app.stripe_checkout_sessions (stripe_customer_id);
CREATE INDEX idx_stripe_checkout_sessions_client_reference_id ON app.stripe_checkout_sessions (client_reference_id);
CREATE INDEX idx_stripe_checkout_sessions_checkout_status ON app.stripe_checkout_sessions (checkout_status);
CREATE INDEX idx_stripe_payment_intents_checkout_session_id ON app.stripe_payment_intents (stripe_checkout_session_id);
CREATE INDEX idx_stripe_payment_intents_order_id ON app.stripe_payment_intents (order_id);
CREATE INDEX idx_stripe_payment_intents_customer_id ON app.stripe_payment_intents (stripe_customer_id);
CREATE INDEX idx_stripe_payment_intents_status ON app.stripe_payment_intents (stripe_status);
CREATE INDEX idx_stripe_payment_intents_latest_charge_id ON app.stripe_payment_intents (latest_charge_id);
CREATE INDEX idx_stripe_refunds_payment_intent_id ON app.stripe_refunds (stripe_payment_intent_id);
CREATE INDEX idx_stripe_refunds_order_id ON app.stripe_refunds (order_id);
CREATE INDEX idx_stripe_refunds_status ON app.stripe_refunds (stripe_status);
CREATE INDEX idx_stripe_events_event_type ON app.stripe_events (event_type);
CREATE INDEX idx_stripe_events_processing_status ON app.stripe_events (processing_status);
CREATE INDEX idx_stripe_events_object_id ON app.stripe_events (stripe_object_id);
CREATE INDEX idx_stripe_events_related_order_id ON app.stripe_events (related_order_id);
CREATE INDEX idx_stripe_events_received_at ON app.stripe_events (received_at DESC);
CREATE INDEX idx_stripe_events_pending_processing ON app.stripe_events (processing_status, received_at)
  WHERE processing_status IN ('received', 'failed');
CREATE INDEX idx_audit_logs_occurred_at ON app.audit_logs (occurred_at DESC);
CREATE INDEX idx_audit_logs_actor_type ON app.audit_logs (actor_type);
CREATE INDEX idx_audit_logs_account_id ON app.audit_logs (account_id);
CREATE INDEX idx_audit_logs_guest_profile_id ON app.audit_logs (guest_profile_id);
CREATE INDEX idx_audit_logs_stripe_event_record_id ON app.audit_logs (stripe_event_record_id);
CREATE INDEX idx_audit_logs_order_id ON app.audit_logs (order_id);
CREATE INDEX idx_audit_logs_entity ON app.audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_correlation_id ON app.audit_logs (correlation_id);
CREATE INDEX idx_audit_logs_request_id ON app.audit_logs (request_id);
CREATE INDEX idx_audit_log_changes_audit_log_id ON app.audit_log_changes (audit_log_id);
CREATE INDEX idx_audit_log_changes_field_name ON app.audit_log_changes (field_name);

CREATE TRIGGER trg_accounts_set_updated_at BEFORE UPDATE ON app.accounts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_guest_profiles_set_updated_at BEFORE UPDATE ON app.guest_profiles FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_products_set_updated_at BEFORE UPDATE ON app.products FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_promotions_set_updated_at BEFORE UPDATE ON app.promotions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_orders_set_updated_at BEFORE UPDATE ON app.orders FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_stripe_checkout_sessions_set_updated_at BEFORE UPDATE ON app.stripe_checkout_sessions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_stripe_payment_intents_set_updated_at BEFORE UPDATE ON app.stripe_payment_intents FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER trg_stripe_refunds_set_updated_at BEFORE UPDATE ON app.stripe_refunds FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMIT;
