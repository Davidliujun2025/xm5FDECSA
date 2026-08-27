CREATE TABLE faq_entry (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('PMP', 'ACP', 'PBA', 'FDE')),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  question TEXT NOT NULL CHECK (length(question) > 0),
  normalized_question TEXT NOT NULL CHECK (length(normalized_question) > 0),
  answer TEXT NOT NULL CHECK (length(answer) > 0),
  keywords TEXT NOT NULL CHECK (json_valid(keywords)),
  source_file TEXT NOT NULL CHECK (length(source_file) > 0),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(domain, ordinal),
  UNIQUE(domain, normalized_question)
) STRICT;

CREATE INDEX faq_entry_domain_ordinal_idx
  ON faq_entry(domain, ordinal);
