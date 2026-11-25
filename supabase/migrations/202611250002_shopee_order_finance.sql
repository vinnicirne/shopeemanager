CREATE TABLE IF NOT EXISTS manager.shopee_order_finance (
  shop_id text NOT NULL REFERENCES manager.shops,
  period date NOT NULL,
  order_sn text NOT NULL,
  payout_cents integer,
  refund_cents integer CHECK (refund_cents >= 0),
  fee_cents integer CHECK (fee_cents >= 0),
  cost_cents integer CHECK (cost_cents >= 0),
  extra_cents integer NOT NULL DEFAULT 0 CHECK (extra_cents >= 0),
  PRIMARY KEY (shop_id, period, order_sn)
);

ALTER TABLE manager.shopee_order_finance ENABLE ROW LEVEL SECURITY;
