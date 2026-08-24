import { assertCanDisable, assertCanPublish } from '../../domain/documents.js';
import { AppError } from '../../domain/errors.js';

function mapDocument(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    topicId: row.topic_id,
    fileName: row.file_name,
    safeName: row.safe_name,
    sha256: row.sha256,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    status: row.status,
    filePath: row.file_path,
    parseVersion: row.parse_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    disabledAt: row.disabled_at,
    jobId: row.job_id ?? null
  };
}

function mapJob(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    documentId: row.document_id,
    type: row.type,
    status: row.status,
    stage: row.stage,
    attemptCount: row.attempt_count,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

function stableDatabaseError(error) {
  if (error instanceof AppError) {
    return error;
  }
  const message = error?.message || '';
  if (error?.errcode === 5 || /database is (locked|busy)/i.test(message)) {
    return new AppError({
      statusCode: 503,
      errorCode: 'RAG_DATABASE_BUSY',
      message: '数据库暂时繁忙，请稍后重试'
    });
  }
  if (/UNIQUE constraint failed: document\.topic_id, document\.sha256/i.test(message)) {
    return new AppError({
      statusCode: 409,
      errorCode: 'RAG_DUPLICATE_DOCUMENT',
      message: '同一 Topic 已存在相同内容的文档'
    });
  }
  if (error?.code?.startsWith('E')) {
    return new AppError({
      statusCode: 500,
      errorCode: 'RAG_FILE_STORAGE_ERROR',
      message: '原文件保存失败'
    });
  }
  return new AppError({
    statusCode: 500,
    errorCode: 'RAG_DATABASE_UNAVAILABLE',
    message: '文档数据操作失败'
  });
}

const DOCUMENT_SELECT = `
  SELECT d.*, (
    SELECT j.id FROM job j WHERE j.document_id = d.id ORDER BY j.created_at DESC, j.id DESC LIMIT 1
  ) AS job_id
  FROM document d
`;

export class DocumentRepository {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    this.statements = {
      topic: database.prepare('SELECT id, status FROM topic WHERE id = ?'),
      documentCount: database.prepare('SELECT COUNT(*) AS count FROM document'),
      totalBytes: database.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM document'),
      duplicate: database.prepare('SELECT id FROM document WHERE topic_id = ? AND sha256 = ?'),
      insertDocument: database.prepare(`
        INSERT INTO document(
          id, topic_id, file_name, safe_name, sha256, mime, size_bytes, status, file_path,
          parse_version, created_at, updated_at, published_at, disabled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertJob: database.prepare(`
        INSERT INTO job(
          id, document_id, type, status, stage, attempt_count, error_code, error_message,
          created_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      listByTopic: database.prepare(`${DOCUMENT_SELECT} WHERE d.topic_id = ? ORDER BY d.created_at ASC, d.id ASC`),
      findDocument: database.prepare(`${DOCUMENT_SELECT} WHERE d.id = ?`),
      findJob: database.prepare('SELECT * FROM job WHERE id = ?'),
      chunkMetadata: database.prepare(`
        SELECT COUNT(*) AS count, COUNT(DISTINCT embedding_model) AS models,
               COUNT(DISTINCT embedding_dim) AS dimensions, COUNT(DISTINCT embedding_space) AS spaces,
               COUNT(DISTINCT parse_version) AS versions
        FROM chunk WHERE document_id = ?
      `),
      publishDocument: database.prepare(`
        UPDATE document SET status = 'PUBLISHED', published_at = ?, disabled_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'READY'
      `),
      disableDocument: database.prepare(`
        UPDATE document SET status = 'DISABLED', disabled_at = ?, updated_at = ?
        WHERE id = ? AND status = 'PUBLISHED'
      `),
      findIdempotency: database.prepare('SELECT * FROM idempotency_record WHERE idempotency_key = ?'),
      insertIdempotency: database.prepare(`
        INSERT INTO idempotency_record(idempotency_key, operation, request_hash, response_status, response_body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
    };
  }

  assertTopicExists(topicId) {
    const topic = this.statements.topic.get(topicId);
    if (!topic) {
      throw new AppError({ statusCode: 404, errorCode: 'RAG_TOPIC_NOT_FOUND', message: 'Topic 不存在' });
    }
    return topic;
  }

  listByTopic(topicId) {
    this.assertTopicExists(topicId);
    return this.statements.listByTopic.all(topicId).map(mapDocument);
  }

  findDocument(documentId) {
    return mapDocument(this.statements.findDocument.get(documentId));
  }

  findJob(jobId) {
    return mapJob(this.statements.findJob.get(jobId));
  }

  publish(documentId, now = new Date()) {
    try {
      const document = this.findDocument(documentId);
      if (!document) {
        throw new AppError({ statusCode: 404, errorCode: 'RAG_DOCUMENT_NOT_FOUND', message: '文档不存在' });
      }
      const metadata = this.statements.chunkMetadata.get(documentId);
      assertCanPublish(document, metadata.count);
      if (metadata.models !== 1 || metadata.dimensions !== 1 || metadata.spaces !== 1 || metadata.versions !== 1) {
        throw new AppError({ statusCode: 409, errorCode: 'RAG_DOCUMENT_NOT_READY', message: '文档索引元数据不一致' });
      }
      const timestamp = now.toISOString();
      if (this.statements.publishDocument.run(timestamp, timestamp, documentId).changes !== 1) {
        throw new AppError({ statusCode: 409, errorCode: 'RAG_DOCUMENT_STATE_CONFLICT', message: '文档状态已变化' });
      }
      return this.findDocument(documentId);
    } catch (error) {
      throw stableDatabaseError(error);
    }
  }

  disable(documentId, now = new Date()) {
    try {
      const document = this.findDocument(documentId);
      if (!document) {
        throw new AppError({ statusCode: 404, errorCode: 'RAG_DOCUMENT_NOT_FOUND', message: '文档不存在' });
      }
      assertCanDisable(document);
      const timestamp = now.toISOString();
      if (this.statements.disableDocument.run(timestamp, timestamp, documentId).changes !== 1) {
        throw new AppError({ statusCode: 409, errorCode: 'RAG_DOCUMENT_STATE_CONFLICT', message: '文档状态已变化' });
      }
      return this.findDocument(documentId);
    } catch (error) {
      throw stableDatabaseError(error);
    }
  }

  createUpload({ key, operation, requestHash, document, job, responseValue, finalizeFile, rollbackFile }) {
    let transactionStarted = false;
    let fileCommitted = false;
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
        return { replayed: true, statusCode: existing.response_status, value: JSON.parse(existing.response_body) };
      }

      const topic = this.assertTopicExists(document.topicId);
      if (topic.status === 'DISABLED') {
        throw new AppError({ statusCode: 409, errorCode: 'RAG_TOPIC_DISABLED', message: 'Topic 已停用' });
      }
      if (topic.status !== 'ACTIVE') {
        throw new AppError({ statusCode: 409, errorCode: 'RAG_TOPIC_NOT_ACTIVE', message: 'Topic 尚未启用' });
      }
      if (this.statements.documentCount.get().count >= this.config.maxTotalFiles) {
        throw new AppError({
          statusCode: 409,
          errorCode: 'RAG_CAPACITY_LIMIT',
          message: '文档数量已达到上限',
          details: { limit: this.config.maxTotalFiles }
        });
      }
      if (this.statements.totalBytes.get().total + document.sizeBytes > this.config.maxTotalStorageBytes) {
        throw new AppError({ statusCode: 409, errorCode: 'RAG_CAPACITY_LIMIT', message: '原文件总容量已达到上限' });
      }
      if (this.statements.duplicate.get(document.topicId, document.sha256)) {
        throw new AppError({
          statusCode: 409,
          errorCode: 'RAG_DUPLICATE_DOCUMENT',
          message: '同一 Topic 已存在相同内容的文档'
        });
      }

      this.statements.insertDocument.run(
        document.id,
        document.topicId,
        document.fileName,
        document.safeName,
        document.sha256,
        document.mime,
        document.sizeBytes,
        document.status,
        document.filePath,
        document.parseVersion,
        document.createdAt,
        document.updatedAt,
        document.publishedAt,
        document.disabledAt
      );
      this.statements.insertJob.run(
        job.id,
        job.documentId,
        job.type,
        job.status,
        job.stage,
        job.attemptCount,
        job.errorCode,
        job.errorMessage,
        job.createdAt,
        job.startedAt,
        job.finishedAt
      );
      finalizeFile();
      fileCommitted = true;
      this.statements.insertIdempotency.run(
        key,
        operation,
        requestHash,
        202,
        JSON.stringify(responseValue),
        new Date().toISOString()
      );
      this.database.exec('COMMIT');
      transactionStarted = false;
      return { replayed: false, statusCode: 202, value: responseValue };
    } catch (error) {
      if (transactionStarted) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // Preserve the original stable error.
        }
      }
      if (fileCommitted) {
        try {
          rollbackFile();
        } catch {
          // The database transaction is already rolled back; do not expose paths.
        }
      }
      throw stableDatabaseError(error);
    }
  }
}
