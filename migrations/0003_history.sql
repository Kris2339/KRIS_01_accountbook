CREATE TABLE IF NOT EXISTS change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  changed_at TEXT NOT NULL,
  changed_by TEXT
);
CREATE TRIGGER IF NOT EXISTS history_transaction_update AFTER UPDATE ON transactions
WHEN OLD.data_json <> NEW.data_json OR OLD.deleted_at IS NOT NEW.deleted_at
BEGIN
  INSERT INTO change_history(entity,entity_id,before_json,after_json,changed_at,changed_by)
  VALUES('transaction',NEW.id,OLD.data_json,CASE WHEN NEW.deleted_at IS NULL THEN NEW.data_json ELSE NULL END,NEW.updated_at,NEW.updated_by);
END;
CREATE TRIGGER IF NOT EXISTS history_transaction_insert AFTER INSERT ON transactions
BEGIN
  INSERT INTO change_history(entity,entity_id,before_json,after_json,changed_at,changed_by)
  VALUES('transaction',NEW.id,NULL,NEW.data_json,NEW.updated_at,NEW.updated_by);
END;
CREATE TRIGGER IF NOT EXISTS history_settings_update AFTER UPDATE ON household_state
WHEN OLD.settings_json <> NEW.settings_json
BEGIN
  INSERT INTO change_history(entity,entity_id,before_json,after_json,changed_at,changed_by)
  VALUES('settings','1',OLD.settings_json,NEW.settings_json,NEW.updated_at,NEW.updated_by);
END;
