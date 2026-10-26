-- Profile (D-064c): a person may override the synced display name and set their own picture.
-- name_override / photo_source tell the Entra sync (D-037) what it may overwrite:
--   name_override = false  -> sync may set name;  photo_source <> 'user' -> sync may set photo.
ALTER TABLE app_user
  ADD COLUMN name_override boolean NOT NULL DEFAULT false,
  ADD COLUMN photo         bytea,
  ADD COLUMN photo_type    text CHECK (photo_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD COLUMN photo_source  text CHECK (photo_source IN ('user', 'synced')),
  ADD COLUMN photo_updated_at timestamptz,
  ADD CONSTRAINT app_user_photo_consistent CHECK (
    (photo IS NULL AND photo_type IS NULL AND photo_source IS NULL AND photo_updated_at IS NULL) OR
    (photo IS NOT NULL AND photo_type IS NOT NULL AND photo_source IS NOT NULL AND photo_updated_at IS NOT NULL)
  ),
  ADD CONSTRAINT app_user_photo_size CHECK (photo IS NULL OR octet_length(photo) <= 262144);
