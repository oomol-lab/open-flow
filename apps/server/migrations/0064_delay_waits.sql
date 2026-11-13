ALTER TABLE wait_receipts ADD COLUMN kind TEXT NOT NULL DEFAULT 'interaction' CHECK (kind IN ('interaction', 'delay'));
