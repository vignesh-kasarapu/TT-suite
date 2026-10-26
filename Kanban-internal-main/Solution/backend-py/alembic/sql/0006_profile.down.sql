-- Reverse of 0006_profile. Overrides and pictures are lost; name keeps its current value.
ALTER TABLE app_user
  DROP CONSTRAINT app_user_photo_size,
  DROP CONSTRAINT app_user_photo_consistent,
  DROP COLUMN photo_updated_at,
  DROP COLUMN photo_source,
  DROP COLUMN photo_type,
  DROP COLUMN photo,
  DROP COLUMN name_override;
