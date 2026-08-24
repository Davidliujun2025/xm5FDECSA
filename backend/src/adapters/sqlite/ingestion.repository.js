import { AppError } from '../../domain/errors.js';

function repositoryError(error) {
  if (error instanceof AppError) {
    return error;
  }
  const message = error?.message || '';
  if (error?.errcode === 5 || /database is (locked|busy)/i.test(message)) {
    return new AppError({ statusCode: 503, errorCode: 'RAG_DATABASE_BUSY', message: '数据库暂时繁忙，请稍后重试' });
  }
  return new AppError({ statusCode: 500, errorCode: 'RAG_DATABASE_UNAVAILABLE', message: '摄取数据操作失败', cause: error });
}

function claimedJob(row) {
  return row && {
    jobId: row.job_id,
    attemptCount: row.attempt_count,
    document: {
      id: row.document_id,
      topicId: row.topic_id,
      fileName: row.file_name,
      mime: row.mime,
      filePath: row.file_path
    }
  };
}

export class IngestionRepository {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    this.statements = {
      interruptedJobs: database.prepare(`
        UPDATE job
        SET status = 'QUEUED', stage = 'QUEUED', started_at = NULL,
            error_code = 'RAG_JOB_INTERRUPTED', error_message = '任务在进程退出后恢复'
        WHERE status = 'PROCESSING'
      `),
      interruptedDocuments: database.prepare(`
        UPDATE document SET status = 'UPLOADED', updated_at = ? WHERE status = 'PROCESSING'
      `),
      nextJob: database.prepare(`
        SELECT j.id AS job_id, j.attempt_count, d.id AS document_id, d.topic_id,
               d.file_name, d.mime, d.file_path
        FROM job j JOIN document d ON d.id = j.document_id
        WHERE j.status = 'QUEUED' AND d.status = 'UPLOADED'
        ORDER BY j.created_at ASC, j.id ASC
        LIMIT 1
      `),
      claimJob: database.prepare(`
        UPDATE job SET status = 'PROCESSING', stage = 'PARSING', attempt_count = attempt_count + 1,
                       error_code = NULL, error_message = NULL, started_at = ?, finished_at = NULL
        WHERE id = ? AND status = 'QUEUED'
      `),
      processingDocument: database.prepare(`
        UPDATE document SET status = 'PROCESSING', updated_at = ? WHERE id = ? AND status = 'UPLOADED'
      `),
      updateStage: database.prepare(`UPDATE job SET stage = ? WHERE id = ? AND status = 'PROCESSING'`),
      jobAttempt: database.prepare('SELECT attempt_count FROM job WHERE id = ? AND document_id = ?'),
      countOtherChunks: database.prepare('SELECT COUNT(*) AS count FROM chunk WHERE document_id <> ?'),
      otherChunkMetadata: database.prepare(`
        SELECT COUNT(*) AS count, MIN(embedding_model) AS model, MIN(embedding_dim) AS dimension,
               MIN(embedding_space) AS space, COUNT(DISTINCT embedding_model) AS models,
               COUNT(DISTINCT embedding_dim) AS dimensions, COUNT(DISTINCT embedding_space) AS spaces
        FROM chunk WHERE document_id <> ?
      `),
      deleteDocumentChunks: database.prepare('DELETE FROM chunk WHERE document_id = ?'),
      insertChunk: database.prepare(`
        INSERT INTO chunk(
          id, topic_id, document_id, ordinal, text, location, text_hash, embedding,
          embedding_dim, embedding_model, embedding_space, parse_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      readyDocument: database.prepare(`
        UPDATE document SET status = 'READY', parse_version = ?, updated_at = ?
        WHERE id = ? AND status = 'PROCESSING'
      `),
      succeedJob: database.prepare(`
        UPDATE job SET status = 'SUCCEEDED', stage = 'READY', error_code = NULL,
                       error_message = NULL, finished_at = ?
        WHERE id = ? AND document_id = ? AND status = 'PROCESSING'
      `),
      retryJob: database.prepare(`
        UPDATE job SET status = 'QUEUED', stage = 'RETRY_QUEUED', error_code = ?, error_message = ?,
                       started_at = NULL, finished_at = NULL
        WHERE id = ? AND document_id = ?
      `),
      failJob: database.prepare(`
        UPDATE job SET status = 'FAILED', stage = 'FAILED', error_code = ?, error_message = ?, finished_at = ?
        WHERE id = ? AND document_id = ?
      `),
      resetDocument: database.prepare(`
        UPDATE document SET status = 'UPLOADED', updated_at = ? WHERE id = ? AND status = 'PROCESSING'
      `),
      failDocument: database.prepare(`
        UPDATE document SET status = 'FAILED', updated_at = ? WHERE id = ? AND status = 'PROCESSING'
      `),
      countChunks: database.prepare('SELECT COUNT(*) AS count FROM chunk'),
      documentChunks: database.prepare('SELECT * FROM chunk WHERE document_id = ? ORDER BY ordinal ASC')
    };
  }

  #transaction(action) {
    let started = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      started = true;
      const value = action();
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      if (started) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // Preserve the original stable error.
        }
      }
      throw repositoryError(error);
    }
  }

  recoverInterrupted(now = new Date()) {
    return this.#transaction(() => {
      const jobs = this.statements.interruptedJobs.run().changes;
      const documents = this.statements.interruptedDocuments.run(now.toISOString()).changes;
      return { jobs, documents };
    });
  }

  claimNext(now = new Date()) {
    return this.#transaction(() => {
      const row = this.statements.nextJob.get();
      if (!row) {
        return null;
      }
      const timestamp = now.toISOString();
      if (this.statements.claimJob.run(timestamp, row.job_id).changes !== 1
        || this.statements.processingDocument.run(timestamp, row.document_id).changes !== 1) {
        throw new AppError({ statusCode: 409, errorCode: 'RAG_JOB_STATE_CONFLICT', message: '任务状态已变化' });
      }
      return claimedJob({ ...row, attempt_count: row.attempt_count + 1 });
    });
  }

  setStage(jobId, stage) {
    this.statements.updateStage.run(stage, jobId);
  }

  complete({ jobId, documentId, chunks, parseVersion, now = new Date() }) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new AppError({ statusCode: 422, errorCode: 'RAG_NO_TEXT_CONTENT', message: '无 chunk 的文档不能进入 READY' });
    }
    return this.#transaction(() => {
      const incoming = chunks[0];
      if (chunks.some((chunk) => (
        chunk.documentId !== documentId
        || chunk.embeddingModel !== incoming.embeddingModel
        || chunk.embeddingDim !== incoming.embeddingDim
        || chunk.embeddingSpace !== incoming.embeddingSpace
        || chunk.parseVersion !== parseVersion
      ))) {
        throw new AppError({ statusCode: 422, errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: '待提交 chunk 元数据不一致' });
      }
      const existing = this.statements.otherChunkMetadata.get(documentId);
      if (existing.count > 0 && (
        existing.models !== 1
        || existing.dimensions !== 1
        || existing.spaces !== 1
        || existing.model !== incoming.embeddingModel
        || existing.dimension !== incoming.embeddingDim
        || existing.space !== incoming.embeddingSpace
      )) {
        throw new AppError({
          statusCode: 422,
          errorCode: 'RAG_MODEL_OUTPUT_INVALID',
          message: 'Embedding 模型、维度或向量空间与现有索引不一致'
        });
      }
      const otherCount = this.statements.countOtherChunks.get(documentId).count;
      if (otherCount + chunks.length > this.config.maxTotalChunks) {
        throw new AppError({
          statusCode: 409,
          errorCode: 'RAG_CAPACITY_LIMIT',
          message: 'chunk 数量已达到上限',
          details: { limit: this.config.maxTotalChunks }
        });
      }
      this.statements.deleteDocumentChunks.run(documentId);
      for (const chunk of chunks) {
        this.statements.insertChunk.run(
          chunk.id,
          chunk.topicId,
          chunk.documentId,
          chunk.ordinal,
          chunk.text,
          chunk.location,
          chunk.textHash,
          chunk.embedding,
          chunk.embeddingDim,
          chunk.embeddingModel,
          chunk.embeddingSpace,
          chunk.parseVersion,
          chunk.createdAt
        );
      }
      const timestamp = now.toISOString();
      if (this.statements.readyDocument.run(parseVersion, timestamp, documentId).changes !== 1
        || this.statements.succeedJob.run(timestamp, jobId, documentId).changes !== 1) {
        throw new AppError({ statusCode: 409, errorCode: 'RAG_JOB_STATE_CONFLICT', message: '任务完成状态冲突' });
      }
      return chunks.length;
    });
  }

  fail({ jobId, documentId, errorCode, errorMessage, retryable, now = new Date() }) {
    return this.#transaction(() => {
      const attempt = this.statements.jobAttempt.get(jobId, documentId);
      if (!attempt) {
        throw new AppError({ statusCode: 404, errorCode: 'RAG_JOB_NOT_FOUND', message: '任务不存在' });
      }
      this.statements.deleteDocumentChunks.run(documentId);
      const timestamp = now.toISOString();
      if (retryable && attempt.attempt_count < 3) {
        this.statements.retryJob.run(errorCode, errorMessage, jobId, documentId);
        this.statements.resetDocument.run(timestamp, documentId);
        return { requeued: true, attemptCount: attempt.attempt_count };
      }
      this.statements.failJob.run(errorCode, errorMessage, timestamp, jobId, documentId);
      this.statements.failDocument.run(timestamp, documentId);
      return { requeued: false, attemptCount: attempt.attempt_count };
    });
  }

  countChunks() {
    return this.statements.countChunks.get().count;
  }

  listDocumentChunks(documentId) {
    return this.statements.documentChunks.all(documentId);
  }
}
