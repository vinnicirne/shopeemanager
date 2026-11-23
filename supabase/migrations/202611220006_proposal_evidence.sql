ALTER TABLE manager.proposals ADD COLUMN IF NOT EXISTS source_task_id uuid;
ALTER TABLE manager.proposals ADD COLUMN IF NOT EXISTS recommended_by text;
