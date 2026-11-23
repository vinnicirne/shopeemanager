CREATE TABLE IF NOT EXISTS manager.sales_observations (
  shop_id text NOT NULL REFERENCES manager.shops,
  period date NOT NULL,
  sku text NOT NULL,
  units int NOT NULL CHECK (units >= 0),
  revenue numeric(14,2) NOT NULL CHECK (revenue >= 0),
  PRIMARY KEY (shop_id, period, sku)
);

CREATE TABLE IF NOT EXISTS manager.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL REFERENCES manager.shops,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('report','stock','sales')),
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (shop_id, run_id) REFERENCES manager.runs (shop_id, id) ON DELETE CASCADE,
  UNIQUE (shop_id, run_id, kind)
);

GRANT SELECT, INSERT, UPDATE ON manager.sales_observations TO manager_app;
GRANT SELECT ON manager.notifications TO manager_app;
ALTER TABLE manager.sales_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_scope ON manager.sales_observations;
CREATE POLICY shop_scope ON manager.sales_observations TO manager_app
  USING (shop_id = current_setting('manager.shop_id',true))
  WITH CHECK (shop_id = current_setting('manager.shop_id',true));
DROP POLICY IF EXISTS shop_scope ON manager.notifications;
CREATE POLICY shop_scope ON manager.notifications TO manager_app
  USING (shop_id = current_setting('manager.shop_id',true));
