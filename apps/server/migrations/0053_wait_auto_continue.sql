ALTER TABLE wait_receipts ADD COLUMN auto_continue_at INTEGER;
ALTER TABLE wait_receipts ADD COLUMN resolution_source TEXT CHECK (resolution_source IN ('manual', 'automatic'));
CREATE INDEX wait_auto_continue_due ON wait_receipts(auto_continue_at) WHERE action IS NULL AND auto_continue_at IS NOT NULL;
