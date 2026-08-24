CREATE UNIQUE INDEX document_id_topic_unique_idx ON document(id, topic_id);

CREATE TABLE chunk (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  text TEXT NOT NULL CHECK (length(text) > 0),
  location TEXT NOT NULL CHECK (json_valid(location)),
  text_hash TEXT NOT NULL,
  embedding BLOB NOT NULL,
  embedding_dim INTEGER NOT NULL CHECK (embedding_dim > 0),
  embedding_model TEXT NOT NULL CHECK (length(embedding_model) > 0),
  embedding_space TEXT NOT NULL CHECK (embedding_space = 'cosine'),
  parse_version TEXT NOT NULL CHECK (length(parse_version) > 0),
  created_at TEXT NOT NULL,
  UNIQUE(document_id, ordinal),
  CHECK(length(embedding) = embedding_dim * 4),
  FOREIGN KEY(document_id, topic_id) REFERENCES document(id, topic_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX chunk_topic_model_idx ON chunk(topic_id, embedding_model, embedding_dim, embedding_space);
CREATE INDEX chunk_document_idx ON chunk(document_id, ordinal);
