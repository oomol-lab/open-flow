ALTER TABLE publications ADD COLUMN live_ended_at INTEGER;
ALTER TABLE publications ADD COLUMN live_enabled_at_end INTEGER
  CHECK ((live_ended_at IS NULL AND live_enabled_at_end IS NULL)
    OR (live_ended_at IS NOT NULL AND live_enabled_at_end IS NOT NULL AND live_enabled_at_end IN (0, 1)));
