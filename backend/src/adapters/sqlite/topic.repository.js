import { AppError } from '../../domain/errors.js';

const MAX_TOPICS = 20;

function mapTopic(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDatabaseError(error) {
  if (error instanceof AppError) {
    return error;
  }
  if (error?.errcode === 5 || /database is (locked|busy)/i.test(error?.message || '')) {
    return new AppError({
      statusCode: 503,
      errorCode: 'RAG_DATABASE_BUSY',
      message: '数据库暂时繁忙，请稍后重试'
    });
  }
  if (/UNIQUE constraint failed: topic\.normalized_name/i.test(error?.message || '')) {
    return new AppError({
      statusCode: 409,
      errorCode: 'RAG_TOPIC_NAME_CONFLICT',
      message: 'Topic 名称已存在'
    });
  }
  return new AppError({
    statusCode: 500,
    errorCode: 'RAG_DATABASE_UNAVAILABLE',
    message: 'Topic 数据操作失败'
  });
}

export class TopicRepository {
  constructor(database) {
    this.database = database;
    this.statements = {
      listAll: database.prepare('SELECT * FROM topic ORDER BY created_at ASC, id ASC'),
      listActive: database.prepare("SELECT * FROM topic WHERE status = 'ACTIVE' ORDER BY created_at ASC, id ASC"),
      findById: database.prepare('SELECT * FROM topic WHERE id = ?'),
      findByName: database.prepare('SELECT id FROM topic WHERE normalized_name = ?'),
      count: database.prepare('SELECT COUNT(*) AS count FROM topic'),
      insert: database.prepare(`
        INSERT INTO topic(id, name, normalized_name, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      update: database.prepare(`
        UPDATE topic
        SET name = ?, normalized_name = ?, description = ?, status = ?, updated_at = ?
        WHERE id = ?
      `),
      findIdempotency: database.prepare('SELECT * FROM idempotency_record WHERE idempotency_key = ?'),
      insertIdempotency: database.prepare(`
        INSERT INTO idempotency_record(idempotency_key, operation, request_hash, response_status, response_body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
    };
  }

  list({ includeInactive = false } = {}) {
    return (includeInactive ? this.statements.listAll.all() : this.statements.listActive.all()).map(mapTopic);
  }

  findById(topicId) {
    return mapTopic(this.statements.findById.get(topicId));
  }

  create(topic) {
    if (this.statements.count.get().count >= MAX_TOPICS) {
      throw new AppError({
        statusCode: 409,
        errorCode: 'RAG_CAPACITY_LIMIT',
        message: 'Topic 数量已达到上限',
        details: { limit: MAX_TOPICS }
      });
    }
    if (this.statements.findByName.get(topic.normalizedName)) {
      throw new AppError({
        statusCode: 409,
        errorCode: 'RAG_TOPIC_NAME_CONFLICT',
        message: 'Topic 名称已存在'
      });
    }
    this.statements.insert.run(
      topic.id,
      topic.name,
      topic.normalizedName,
      topic.description,
      topic.status,
      topic.createdAt,
      topic.updatedAt
    );
    return topic;
  }

  update(topic) {
    const duplicate = this.statements.findByName.get(topic.normalizedName);
    if (duplicate && duplicate.id !== topic.id) {
      throw new AppError({
        statusCode: 409,
        errorCode: 'RAG_TOPIC_NAME_CONFLICT',
        message: 'Topic 名称已存在'
      });
    }
    this.statements.update.run(
      topic.name,
      topic.normalizedName,
      topic.description,
      topic.status,
      topic.updatedAt,
      topic.id
    );
    return topic;
  }

  executeIdempotent({ key, operation, requestHash, responseStatus, action }) {
    let transactionStarted = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      const existing = this.statements.findIdempotency.get(key);
      if (existing) {
        if (existing.operation !== operation || existing.request_hash !== requestHash) {
          throw new AppError({
            statusCode: 409,
            errorCode: 'RAG_IDEMPOTENCY_CONFLICT',
            message: 'Idempotency-Key 已用于不同请求'
          });
        }
        this.database.exec('COMMIT');
        transactionStarted = false;
        return {
          replayed: true,
          statusCode: existing.response_status,
          value: JSON.parse(existing.response_body)
        };
      }

      const value = action();
      this.statements.insertIdempotency.run(
        key,
        operation,
        requestHash,
        responseStatus,
        JSON.stringify(value),
        new Date().toISOString()
      );
      this.database.exec('COMMIT');
      transactionStarted = false;
      return { replayed: false, statusCode: responseStatus, value };
    } catch (error) {
      if (transactionStarted) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // The original mapped error is more useful than a rollback failure.
        }
      }
      throw mapDatabaseError(error);
    }
  }
}
