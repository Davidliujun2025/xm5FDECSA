import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

const sampleUrl = new URL('../../examples/sample-documents/acceptance-sample.md', import.meta.url);
const sampleReadmeUrl = new URL('../../examples/sample-documents/README.md', import.meta.url);
const sample = readFileSync(sampleUrl, 'utf8');
const sampleReadme = readFileSync(sampleReadmeUrl, 'utf8');

test('acceptance sample is synthetic, licensed and uploadable', () => {
  assert.ok(sample.includes('来源'));
  assert.ok(sample.includes('CC0 1.0'));
  assert.ok(sample.includes('合成虚构数据'));
  assert.ok(sample.includes('与任何真实企业、产品或个人无关'));
  assert.ok(statSync(sampleUrl).size <= 30 * 1024 * 1024);
  assert.ok(!/sk-[a-z0-9]{8,}/i.test(sample));
  assert.ok(!/(?:api[_-]?key|token|password)\s*[=:]\s*\S+/i.test(sample));
});

test('sample contains verifiable facts matching the manual question set patterns', () => {
  assert.ok(sample.includes('42'));
  assert.ok(sample.includes('S-007'));
  assert.ok(sample.includes('编号'));
  assert.ok(sample.includes('三个要点'));
  assert.ok(sample.includes('最后一行数据'));
});

test('sample README states source, license and the no-enterprise-workbook rule', () => {
  assert.ok(sampleReadme.includes('acceptance-sample.md'));
  assert.ok(sampleReadme.includes('CC0 1.0'));
  assert.ok(sampleReadme.includes('不包含任何真实企业资料'));
  assert.ok(sampleReadme.includes('不在此目录提交企业工作簿'));
});
