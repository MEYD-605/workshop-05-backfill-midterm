-- Discord Indexer Schema — SQLite Tables

CREATE TABLE IF NOT EXISTS blocks (
  number      INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,
  end_ts      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  activity    TEXT NOT NULL DEFAULT 'normal',
  event_count INTEGER NOT NULL DEFAULT 0,
  parent_hash TEXT NOT NULL DEFAULT '',
  hash        TEXT NOT NULL DEFAULT '',
  channels    TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  block_num   INTEGER REFERENCES blocks(number),
  server_id   TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  channel_name TEXT,
  thread_id   TEXT,
  author_id   TEXT NOT NULL,
  author_name TEXT,
  author_bot  INTEGER DEFAULT 0,
  content     TEXT NOT NULL,
  msg_type    TEXT DEFAULT 'CHAT',
  timestamp   INTEGER NOT NULL,
  edited_at   INTEGER,
  reply_to    TEXT,
  has_attachments INTEGER DEFAULT 0,
  has_code    INTEGER DEFAULT 0,
  score       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS authors (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  display_name TEXT,
  is_bot       INTEGER DEFAULT 0,
  is_oracle    INTEGER DEFAULT 0,
  oracle_number INTEGER,
  message_count INTEGER DEFAULT 0,
  first_seen   INTEGER,
  last_seen    INTEGER
);

CREATE TABLE IF NOT EXISTS channels (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  server_id     TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  last_indexed  INTEGER
);

CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  channel_id  TEXT NOT NULL,
  creator_id  TEXT,
  message_count INTEGER DEFAULT 0,
  created_at  INTEGER,
  archived    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS code_blocks (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id),
  language    TEXT DEFAULT 'text',
  content     TEXT NOT NULL,
  line_count  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reactions (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  count       INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cursors (
  channel_id  TEXT PRIMARY KEY,
  last_message_id TEXT,
  last_timestamp INTEGER,
  total_indexed INTEGER DEFAULT 0
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  author_name,
  channel_name,
  content='messages',
  content_rowid='rowid'
);

-- Index optimizations
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(msg_type);
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);
CREATE INDEX IF NOT EXISTS idx_blocks_activity ON blocks(activity);
