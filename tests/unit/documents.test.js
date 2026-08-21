import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  createUploadRecords,
  inspectUploadedFile,
  validateDocumentId,
  validateJobId
} from '../../backend/src/domain/documents.js';
import { FORMAT_FIXTURES } from '../helpers/document-fixtures.js';

test('all six supported formats pass extension, MIME and header validation', () => {
  for (const fixture of FORMAT_FIXTURES) {
    const inspected = inspectUploadedFile({
      originalName: `sample.${fixture.extension}`,
      mime: fixture.mime,
      size: fixture.bytes.length,
      bytes: fixture.bytes,
      maxFileBytes: 30 * 1024 * 1024
    });
    assert.equal(inspected.safeName, `source.${fixture.extension}`);
  }
});

test('upload records use generated IDs and never use display name in disk path', () => {
  const bytes = Buffer.from('safe text', 'utf8');
  const prepared = {
    fileName: '用户上传 名称.txt',
    safeName: 'source.txt',
    mime: 'text/plain',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
  const { document, job } = createUploadRecords(prepared, 'topic_0123456789abcdef0123456789abcdef', {
    now: () => new Date('2026-08-21T08:00:00.000Z'),
    documentIdGenerator: () => 'doc_0123456789abcdef0123456789abcdef',
    jobIdGenerator: () => 'job_0123456789abcdef0123456789abcdef'
  });
  assert.equal(document.filePath, 'original/topic_0123456789abcdef0123456789abcdef/doc_0123456789abcdef0123456789abcdef/source.txt');
  assert.equal(document.filePath.includes(document.fileName), false);
  assert.equal(document.status, 'UPLOADED');
  assert.equal(job.status, 'QUEUED');
});

test('empty, unsupported, mismatched, corrupt and traversal inputs fail closed', () => {
  const validText = Buffer.from('content', 'utf8');
  const cases = [
    { originalName: '../escape.txt', mime: 'text/plain', size: validText.length, bytes: validText, code: 'RAG_FILE_PATH_INVALID' },
    { originalName: 'bad.exe', mime: 'application/octet-stream', size: validText.length, bytes: validText, code: 'RAG_UNSUPPORTED_FORMAT' },
    { originalName: 'bad.pdf', mime: 'text/plain', size: validText.length, bytes: validText, code: 'RAG_FILE_INVALID' },
    { originalName: 'bad.pdf', mime: 'application/pdf', size: validText.length, bytes: validText, code: 'RAG_FILE_INVALID' },
    { originalName: 'empty.txt', mime: 'text/plain', size: 0, bytes: Buffer.alloc(0), code: 'RAG_NO_TEXT_CONTENT' },
    { originalName: 'blank.md', mime: 'text/markdown', size: 3, bytes: Buffer.from('   '), code: 'RAG_NO_TEXT_CONTENT' }
  ];
  for (const input of cases) {
    assert.throws(
      () => inspectUploadedFile({ ...input, maxFileBytes: 30 * 1024 * 1024 }),
      (error) => error.errorCode === input.code
    );
  }
  assert.throws(() => validateDocumentId('bad'), (error) => error.errorCode === 'RAG_INVALID_REQUEST');
  assert.throws(() => validateJobId('bad'), (error) => error.errorCode === 'RAG_INVALID_REQUEST');
});
