-- Reverse of 0008_s3b.
ALTER TABLE team DROP COLUMN teams_webhook_url_enc;
ALTER TABLE user_preference DROP COLUMN notify_email;
DROP TABLE mail_stub_message;
DROP TABLE notification;
DROP TABLE time_entry;
