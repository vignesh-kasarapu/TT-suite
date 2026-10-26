-- Reverse of 0007_s3a. Replies lose their parent link (become top-level); votes and attachments are dropped.
DROP TABLE attachment;
DROP TABLE comment_vote;
DROP INDEX IF EXISTS card_comment_parent_idx;
ALTER TABLE card_comment DROP COLUMN parent_id;
DROP INDEX IF EXISTS card_event_created_idx;
ALTER TABLE app_user DROP COLUMN inbox_seen_at;
