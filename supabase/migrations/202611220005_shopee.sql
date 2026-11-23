ALTER TABLE manager.products ADD COLUMN IF NOT EXISTS shopee_item bigint;
ALTER TABLE manager.products ADD COLUMN IF NOT EXISTS shopee_model bigint;

CREATE TABLE IF NOT EXISTS manager.shopee_links (
  shop_id text PRIMARY KEY REFERENCES manager.shops,
  remote_id bigint NOT NULL,
  mode text NOT NULL CHECK (mode IN ('sandbox','live')),
  sealed text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mode,remote_id)
);

CREATE TABLE IF NOT EXISTS manager.shopee_auth (
  state_hash text PRIMARY KEY,
  shop_id text NOT NULL UNIQUE REFERENCES manager.shops,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);

CREATE TABLE IF NOT EXISTS manager.shopee_jobs (
  shop_id text PRIMARY KEY REFERENCES manager.shops,
  status text NOT NULL CHECK (status IN ('queued','running','failed','done')),
  phase text NOT NULL DEFAULT 'catalog' CHECK (phase IN ('catalog','orders','ads')),
  period date NOT NULL,
  page_offset int NOT NULL DEFAULT 0,
  cursor text NOT NULL DEFAULT '',
  lease uuid,
  deadline timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manager.shopee_sales (
  shop_id text REFERENCES manager.shops,
  period date,
  order_sn text,
  sku text,
  units int NOT NULL CHECK (units >= 0),
  revenue numeric(14,2) NOT NULL CHECK (revenue >= 0),
  PRIMARY KEY (shop_id, period, order_sn, sku)
);

CREATE TABLE IF NOT EXISTS manager.shopee_price_operations (
  proposal_id uuid PRIMARY KEY REFERENCES manager.proposals,
  shop_id text NOT NULL REFERENCES manager.shops,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','uncertain','applied','failed','expired')),
  item bigint NOT NULL,
  model bigint NOT NULL,
  lease uuid,
  deadline timestamptz,
  checked_at timestamptz,
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shopee_price_one_active
ON manager.shopee_price_operations (shop_id,item,model) WHERE status='sending';

CREATE TABLE IF NOT EXISTS manager.shopee_ads (
  shop_id text NOT NULL REFERENCES manager.shops,
  period date NOT NULL,
  metrics jsonb NOT NULL,
  PRIMARY KEY (shop_id, period)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['shopee_links','shopee_auth','shopee_jobs','shopee_sales','shopee_price_operations','shopee_ads']
  LOOP
    EXECUTE format('ALTER TABLE manager.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END;
$$;

GRANT INSERT ON manager.shopee_price_operations TO manager_app;
DROP POLICY IF EXISTS shop_scope ON manager.shopee_price_operations;
CREATE POLICY shop_scope ON manager.shopee_price_operations
  FOR INSERT TO manager_app WITH CHECK (shop_id = current_setting('manager.shop_id',true));
