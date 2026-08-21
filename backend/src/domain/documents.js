import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { AppError } from './errors.js';

export const DOCUMENT_STATUS = Object.freeze({
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  PUBLISHED: 'PUBLISHED',
  DISABLED: 'DISABLED',
  FAILED: 'FAILED'
});

export const JOB_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED'
});

export const SUPPORTED_FORMATS = Object.freeze({
  '.pdf': { mime: ['application/pdf'], kind: 'pdf' },
  '.docx': { mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], kind: 'office' },
  '.xlsx': { mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], kind: 'office' },
  '.pptx': { mime: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], kind: 'office' },
  '.md': { mime: ['text/markdown', 'text/plain'], kind: 'text' },
  '.txt': { mime: ['text/plain'], kind: 'text' }
});

const TOPIC_ID_PATTERN = /^topic_[0-9a-f]{32}$/;
const DOCUMENT_ID_PATTERN = /^doc_[0-9a-f]{32}$/;
const JOB_ID_PATTERN = /^job_[0-9a-f]{32}$/;

function documentError(statusCode, errorCode, message, details = {}) {
  throw new AppError({ statusCode, errorCode, message, details });
}

export function validateTopicId(topicId) {
  if (!TOPIC_ID_PATTERN.test(topicId || '')) {
    documentError(400, 'RAG_INVALID_REQUEST', 'topicId 格式非法', { field: 'topicId' });
  }
  return topicId;
}

export function validateDocumentId(documentId) {
  if (!DOCUMENT_ID_PATTERN.test(documentId || '')) {
    documentError(400, 'RAG_INVALID_REQUEST', 'documentId 格式非法', { field: 'documentId' });
  }
  return documentId;
}

export function validateJobId(jobId) {
  if (!JOB_ID_PATTERN.test(jobId || '')) {
    documentError(400, 'RAG_INVALID_REQUEST', 'jobId 格式非法', { field: 'jobId' });
  }
  return jobId;
}

function safeDisplayName(originalName) {
  if (typeof originalName !== 'string') {
    documentError(400, 'RAG_INVALID_REQUEST', '文件名缺失');
  }
  if (originalName.includes('/') || originalName.includes('\\')) {
    documentError(400, 'RAG_FILE_PATH_INVALID', '文件名不得包含路径');
  }
  const baseName = originalName.normalize('NFKC').trim();
  if (!baseName || baseName.length > 255 || /[\u0000-\u001f\u007f]/.test(baseName)) {
    documentError(400, 'RAG_INVALID_REQUEST', '文件名格式非法');
  }
  return baseName;
}

function hasPdfHeader(bytes) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
}

function hasOfficeZipStructure(bytes) {
  if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return false;
  }
  const tailStart = Math.max(0, bytes.length - 65_557);
  return bytes.subarray(tailStart).indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0;
}

function validateUtf8Text(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    documentError(422, 'RAG_FILE_INVALID', '文本文件必须使用 UTF-8 编码');
  }
  if (!text.trim()) {
    documentError(422, 'RAG_NO_TEXT_CONTENT', '文件没有有效文本内容');
  }
}

export function inspectUploadedFile({ originalName, mime, size, bytes, maxFileBytes }) {
  const fileName = safeDisplayName(originalName);
  const extension = path.extname(fileName).toLowerCase();
  const format = SUPPORTED_FORMATS[extension];
  if (!format) {
    documentError(422, 'RAG_UNSUPPORTED_FORMAT', '文件格式不受支持');
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    documentError(422, 'RAG_NO_TEXT_CONTENT', '文件为空');
  }
  if (size > maxFileBytes) {
    documentError(413, 'RAG_FILE_TOO_LARGE', '文件超过允许大小');
  }
  if (!format.mime.includes((mime || '').toLowerCase())) {
    documentError(422, 'RAG_FILE_INVALID', '文件扩展名与 MIME 不匹配');
  }
  if (format.kind === 'pdf' && !hasPdfHeader(bytes)) {
    documentError(422, 'RAG_FILE_INVALID', 'PDF 文件头损坏');
  }
  if (format.kind === 'office' && !hasOfficeZipStructure(bytes)) {
    documentError(422, 'RAG_FILE_INVALID', 'Office 文件结构损坏');
  }
  if (format.kind === 'text') {
    validateUtf8Text(bytes);
  }

  return Object.freeze({
    fileName,
    extension: extension.slice(1),
    safeName: `source${extension}`,
    mime: mime.toLowerCase(),
    size
  });
}

export function createUploadRecords(prepared, topicId, {
  now = () => new Date(),
  documentIdGenerator = () => `doc_${randomUUID().replaceAll('-', '')}`,
  jobIdGenerator = () => `job_${randomUUID().replaceAll('-', '')}`
} = {}) {
  validateTopicId(topicId);
  const timestamp = now().toISOString();
  const documentId = documentIdGenerator();
  const jobId = jobIdGenerator();
  const filePath = `original/${topicId}/${documentId}/${prepared.safeName}`;
  return {
    document: Object.freeze({
      id: documentId,
      topicId,
      fileName: prepared.fileName,
      safeName: prepared.safeName,
      sha256: prepared.sha256,
      mime: prepared.mime,
      sizeBytes: prepared.size,
      status: DOCUMENT_STATUS.UPLOADED,
      filePath,
      parseVersion: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      publishedAt: null,
      disabledAt: null
    }),
    job: Object.freeze({
      id: jobId,
      documentId,
      type: 'INGEST_DOCUMENT',
      status: JOB_STATUS.QUEUED,
      stage: JOB_STATUS.QUEUED,
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null
    })
  };
}

export function documentToResponse(document) {
  return {
    documentId: document.id,
    topicId: document.topicId,
    fileName: document.fileName,
    mime: document.mime,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    status: document.status,
    jobId: document.jobId ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

export function jobToResponse(job) {
  return {
    jobId: job.id,
    documentId: job.documentId,
    type: job.type,
    status: job.status,
    stage: job.stage,
    attemptCount: job.attemptCount,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}
