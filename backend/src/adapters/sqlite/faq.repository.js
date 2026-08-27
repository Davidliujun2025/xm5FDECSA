import { AppError } from '../../domain/errors.js';

function mapRow(row) {
  return Object.freeze({
    id: row.id,
    domain: row.domain,
    ordinal: row.ordinal,
    question: row.question,
    normalizedQuestion: row.normalized_question,
    answer: row.answer,
    keywords: Object.freeze(JSON.parse(row.keywords)),
    sourceFile: row.source_file
  });
}

export class FaqRepository {
  constructor(database) {
    this.database = database;
    this.statements = {
      clear: database.prepare('DELETE FROM faq_entry'),
      insert: database.prepare(`
        INSERT INTO faq_entry(
          id, domain, ordinal, question, normalized_question, answer,
          keywords, source_file, source_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      list: database.prepare('SELECT * FROM faq_entry ORDER BY domain, ordinal'),
      find: database.prepare('SELECT * FROM faq_entry WHERE id = ?')
    };
  }

  replaceAll(entries, now = new Date().toISOString()) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.statements.clear.run();
      for (const entry of entries) {
        this.statements.insert.run(
          entry.id,
          entry.domain,
          entry.ordinal,
          entry.question,
          entry.normalizedQuestion,
          entry.answer,
          JSON.stringify(entry.keywords),
          entry.sourceFile,
          entry.sourceHash,
          now,
          now
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw new AppError({
        statusCode: 500,
        errorCode: 'RAG_DATABASE_UNAVAILABLE',
        message: 'FAQ 知识库同步失败',
        cause: error
      });
    }
  }

  list() {
    return this.statements.list.all().map(mapRow);
  }

  findById(id) {
    const row = this.statements.find.get(id);
    return row ? mapRow(row) : null;
  }
}
