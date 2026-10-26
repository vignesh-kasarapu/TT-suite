DROP TABLE inbox_read;
ALTER TABLE app_user DROP COLUMN inbox_cleared_before;
ALTER TABLE user_preference DROP COLUMN inbox_window_days;
