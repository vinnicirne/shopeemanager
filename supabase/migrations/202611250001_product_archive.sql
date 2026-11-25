ALTER TABLE manager.products ADD COLUMN IF NOT EXISTS shopee_status text;
ALTER TABLE manager.products ADD COLUMN IF NOT EXISTS archived_at timestamptz;
