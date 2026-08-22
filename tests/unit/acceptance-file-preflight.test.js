import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { preflightAcceptanceFile } from '../../frontend/src/components/acceptance-file.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const POLICY = Object.freeze({
  supportedFormats: ['PDF', 'DOCX', 'XLSX', 'PPTX', 'MD', 'TXT'],
  maxFileBytes: 30 * 1024 * 1024
});

function fakeFile(name, size) {
  return { name, size };
}

test('browser preflight accepts exactly the six supported extensions within size bounds', () => {
  for (const extension of POLICY.supportedFormats) {
    const result = preflightAcceptanceFile(fakeFile(`脱敏资料.${extension.toLowerCase()}`, 1), POLICY);
    assert.deepEqual(result, { ok: true, extension });
  }
  assert.deepEqual(
    preflightAcceptanceFile(fakeFile('UPPER.TXT', POLICY.maxFileBytes), POLICY),
    { ok: true, extension: 'TXT' }
  );
});

test('browser preflight rejects unsupported, missing, empty and oversized files with readable errors', () => {
  for (const name of ['旧文档.doc', '表格.xls', '演示.ppt', '压缩包.zip', '图片.png', '没有扩展名']) {
    const result = preflightAcceptanceFile(fakeFile(name, 10), POLICY);
    assert.equal(result.ok, false);
    assert.equal(result.error.errorCode, 'LOCAL_FORMAT_CHECK');
    assert.match(result.error.message, /不支持/);
  }
  for (const size of [0, POLICY.maxFileBytes + 1, Number.NaN]) {
    const result = preflightAcceptanceFile(fakeFile('边界.txt', size), POLICY);
    assert.equal(result.ok, false);
    assert.equal(result.error.errorCode, 'LOCAL_SIZE_CHECK');
    assert.match(result.error.message, /大于 0 B/);
    assert.match(result.error.message, /30\.00 MB/);
  }
});

test('component preflights before retaining a file and cannot upload while context is loading', () => {
  const component = readFileSync(path.join(ROOT, 'frontend/src/components/UploadAcceptance.jsx'), 'utf8');
  const preflightIndex = component.indexOf('preflightAcceptanceFile(selectedFile, context)');
  const retainIndex = component.indexOf('setFile(selectedFile)');
  assert.ok(preflightIndex >= 0 && retainIndex > preflightIndex);
  assert.equal(component.includes('disabled={!context || busy}'), true);
  assert.equal(component.includes('role="alert"'), true);
});
