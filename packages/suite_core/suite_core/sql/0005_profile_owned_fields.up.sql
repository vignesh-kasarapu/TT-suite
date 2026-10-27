-- Once a person sets their own name or photo on Profile, the Microsoft (Graph) sync at sign-in
-- leaves that field alone.
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS name_edited    boolean NOT NULL DEFAULT false;
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS photo_uploaded boolean NOT NULL DEFAULT false;
