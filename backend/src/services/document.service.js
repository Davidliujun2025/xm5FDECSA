import { createHash } from 'node:crypto';

import {
  createUploadRecords,
  DOCUMENT_STATUS,
  documentToResponse,
  jobToResponse,
  validateDocumentId,
  validateJobId,
  validateTopicId
} from '../domain/documents.js';
import { AppError } from '../domain/errors.js';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function requireIdempotencyKey(key) {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key 缺失或格式非法'
    });
  }
  return key;
}

function hashRequest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class DocumentService {
  constructor(repository, fileStore, { onJobQueued } = {}) {
    this.repository = repository;
    this.fileStore = fileStore;
    this.onJobQueued = onJobQueued;
  }

  async uploadDocument({ topicId, file, idempotencyKey }) {
    validateTopicId(topicId);
    const key = requireIdempotencyKey(idempotencyKey);
    let prepared;
    try {
      prepared = await this.fileStore.prepareUpload(file);
      const { document, job } = createUploadRecords(prepared, topicId);
      const responseValue = {
        documentId: document.id,
        jobId: job.id,
        status: document.status,
        jobStatus: job.status
      };
      const result = this.repository.createUpload({
        key,
        operation: 'documents:upload',
        requestHash: hashRequest({
          topicId,
          fileName: prepared.fileName,
          mime: prepared.mime,
          size: prepared.size,
          sha256: prepared.sha256
        }),
        document,
        job,
        responseValue,
        finalizeFile: () => this.fileStore.commitPrepared(prepared, document.filePath),
        rollbackFile: () => this.fileStore.removeCommitted(document.filePath)
      });
      if (!result.replayed) {
        this.onJobQueued?.();
      }
      return result;
    } finally {
      await this.fileStore.cleanupTemporary(prepared?.temporaryPath ?? file?.path);
    }
  }

  listDocuments(topicId) {
    validateTopicId(topicId);
    return this.repository.listByTopic(topicId).map(documentToResponse);
  }

  getDocument(documentId, { browserSession = false } = {}) {
    validateDocumentId(documentId);
    const document = this.repository.findDocument(documentId);
    if (!document || (browserSession && document.status !== DOCUMENT_STATUS.PUBLISHED)) {
      throw new AppError({
        statusCode: 404,
        errorCode: 'RAG_DOCUMENT_NOT_FOUND',
        message: '文档不存在或不可访问'
      });
    }
    return { raw: document, response: documentToResponse(document) };
  }

  getJob(jobId) {
    validateJobId(jobId);
    const job = this.repository.findJob(jobId);
    if (!job) {
      throw new AppError({ statusCode: 404, errorCode: 'RAG_JOB_NOT_FOUND', message: '任务不存在' });
    }
    return jobToResponse(job);
  }

  publishDocument(documentId) {
    validateDocumentId(documentId);
    return documentToResponse(this.repository.publish(documentId));
  }

  disableDocument(documentId) {
    validateDocumentId(documentId);
    return documentToResponse(this.repository.disable(documentId));
  }

  async openDocumentFile(documentId, { browserSession = false } = {}) {
    const { raw } = this.getDocument(documentId, { browserSession });
    const file = await this.fileStore.openReadStream(raw.filePath);
    return {
      ...file,
      fileName: raw.fileName,
      mime: raw.mime
    };
  }
}
