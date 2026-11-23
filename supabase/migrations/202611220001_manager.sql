CREATE SCHEMA IF NOT EXISTS manager;
REVOKE ALL ON SCHEMA manager FROM PUBLIC;

CREATE TABLE IF NOT EXISTS manager.shops (
  id text PRIMARY KEY,
  name text NOT NULL,
  fixture boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{"daily":false,"hour":8,"dailyLimit":1,"monthlyLimit":20,"paused":[],"instructions":{},"lastWorker":null}'
);

CREATE TABLE IF NOT EXISTS manager.members (
  shop_id text REFERENCES manager.shops ON DELETE CASCADE,
  user_id text,
  role text NOT NULL CHECK (role IN ('owner','operator','reader')),
  PRIMARY KEY (shop_id, user_id)
);

CREATE TABLE IF NOT EXISTS manager.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL REFERENCES manager.shops,
  workflow text NOT NULL CHECK (workflow IN ('oportunidade','diario','atendimento')),
  brief text NOT NULL,
  source text NOT NULL CHECK (source IN ('manual','schedule')),
  request_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, request_key),
  UNIQUE (shop_id, id)
);

CREATE TABLE IF NOT EXISTS manager.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL,
  run_id uuid NOT NULL,
  agent text NOT NULL,
  stage int NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','blocked')),
  attempts int NOT NULL DEFAULT 0,
  lease uuid,
  deadline timestamptz,
  result text,
  error text,
  FOREIGN KEY (shop_id, run_id) REFERENCES manager.runs (shop_id, id) ON DELETE CASCADE,
  UNIQUE (run_id, agent),
  UNIQUE (shop_id, id)
);
CREATE INDEX IF NOT EXISTS tasks_schedule ON manager.tasks (status, stage, deadline);

CREATE TABLE IF NOT EXISTS manager.products (
  shop_id text REFERENCES manager.shops,
  sku text,
  name text NOT NULL,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  cost numeric(14,2) CHECK (cost >= 0),
  fee numeric(14,2) CHECK (fee >= 0),
  stock int NOT NULL CHECK (stock >= 0),
  units int NOT NULL CHECK (units >= 0),
  revenue numeric(14,2) NOT NULL CHECK (revenue >= 0),
  version int NOT NULL DEFAULT 1,
  PRIMARY KEY (shop_id, sku)
);

CREATE TABLE IF NOT EXISTS manager.audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL REFERENCES manager.shops,
  event text NOT NULL,
  actor text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_shop ON manager.audit (shop_id, created_at DESC);

CREATE OR REPLACE FUNCTION manager.protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_append_only ON manager.audit;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON manager.audit
FOR EACH ROW EXECUTE FUNCTION manager.protect_audit();

CREATE TABLE IF NOT EXISTS manager.usage (
  task_id uuid,
  attempt int,
  shop_id text NOT NULL,
  agent text NOT NULL,
  model text NOT NULL,
  input int,
  output int,
  cost numeric(18,8) NOT NULL,
  rates jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','settled','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, attempt),
  FOREIGN KEY (shop_id, task_id) REFERENCES manager.tasks (shop_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS usage_shop ON manager.usage (shop_id, created_at);

CREATE TABLE IF NOT EXISTS manager.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL REFERENCES manager.shops,
  sku text NOT NULL,
  price numeric(14,2) NOT NULL CHECK (price > 0),
  previous_price numeric(14,2) NOT NULL,
  product_version int NOT NULL,
  evidence text NOT NULL,
  author text NOT NULL,
  decided_by text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','applied','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 days',
  FOREIGN KEY (shop_id, sku) REFERENCES manager.products (shop_id, sku)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['shops','members','runs','tasks','products','audit','usage','proposals']
  LOOP
    EXECUTE format('ALTER TABLE manager.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END;
$$;
