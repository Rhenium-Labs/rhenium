-- CreateTable
CREATE TABLE "AuthSession" (
    user_id       TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL DEFAULT '',
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    TIMESTAMP(3) NOT NULL,
    updated_at    TIMESTAMP(3) NOT NULL DEFAULT NOW(),

    username      TEXT,
    global_name   TEXT,
    avatar        TEXT
);

CREATE UNIQUE INDEX AuthSession_session_id_key
    ON "AuthSession" (session_id);