CREATE TABLE chat_session (
  id TEXT PRIMARY KEY,
  user_ip TEXT NOT NULL CHECK (length(user_ip) BETWEEN 2 AND 64),
  topic_id TEXT NOT NULL CHECK (length(topic_id) > 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ENDED')),
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  ended_at TEXT
) STRICT;

CREATE UNIQUE INDEX chat_session_active_ip_topic_idx
  ON chat_session(user_ip, topic_id)
  WHERE status = 'ACTIVE';

CREATE INDEX chat_session_ip_activity_idx
  ON chat_session(user_ip, topic_id, last_active_at DESC);

CREATE TABLE chat_message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_session(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  content TEXT NOT NULL CHECK (length(content) > 0),
  intent TEXT,
  branch TEXT CHECK (branch IS NULL OR branch IN ('9-1', '9-2', '9-3')),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence)
) STRICT;

CREATE INDEX chat_message_session_sequence_idx
  ON chat_message(session_id, sequence DESC);
