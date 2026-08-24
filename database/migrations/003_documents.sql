CREATE TABLE document (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topic(id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  safe_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  status TEXT NOT NULL CHECK (status IN ('UPLOADED', 'PROCESSING', 'READY', 'PUBLISHED', 'DISABLED', 'FAILED')),
  file_path TEXT NOT NULL,
  parse_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  disabled_at TEXT,
  UNIQUE(topic_id, sha256)
) STRICT;

CREATE INDEX document_topic_status_idx ON document(topic_id, status, created_at DESC);

CREATE TABLE job (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES document(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type = 'INGEST_DOCUMENT'),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  stage TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
) STRICT;

CREATE INDEX job_status_created_idx ON job(status, created_at ASC);
CREATE INDEX job_document_idx ON job(document_id, created_at DESC);
