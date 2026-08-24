import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAndChunkDocument } from '../../backend/src/services/ingestion.service.js';
import { docxFixture, pdfFixture, pptxFixture, xlsxFixture } from '../helpers/parser-fixtures.js';

const MIME = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
  txt: 'text/plain'
});

async function successFixtures() {
  const rows = [];
  for (let sample = 1; sample <= 3; sample += 1) {
    rows.push(
      { format: 'pdf', bytes: pdfFixture(`PDF matrix ${sample}`), expected: `PDF matrix ${sample}` },
      { format: 'docx', bytes: docxFixture([`DOCX matrix ${sample}`]), expected: `DOCX matrix ${sample}` },
      { format: 'xlsx', bytes: await xlsxFixture(`XLSX matrix ${sample}`, `Sheet${sample}`), expected: `XLSX matrix ${sample}` },
      { format: 'pptx', bytes: pptxFixture([`PPTX matrix ${sample}`]), expected: `PPTX matrix ${sample}` },
      { format: 'md', bytes: Buffer.from(`# Matrix ${sample}\n\nMarkdown matrix ${sample}.`, 'utf8'), expected: `Matrix ${sample}` },
      { format: 'txt', bytes: Buffer.from(`TXT matrix ${sample}.`, 'utf8'), expected: `TXT matrix ${sample}.` }
    );
  }
  return rows;
}

test('PDF, DOCX, XLSX, PPTX, MD and TXT each pass three independent success samples', async () => {
  const counts = new Map();
  for (const [index, fixture] of (await successFixtures()).entries()) {
    const result = await parseAndChunkDocument({
      documentId: `doc_matrix_${String(index).padStart(2, '0')}`,
      fileName: `matrix-${index}.${fixture.format}`,
      mime: MIME[fixture.format],
      bytes: fixture.bytes
    });
    assert.ok(result.blocks.some((block) => block.text.includes(fixture.expected)), `${fixture.format}: ${fixture.expected}`);
    assert.ok(result.chunks.length >= 1, fixture.format);
    assert.ok(result.chunks.every((chunk) => chunk.location?.start && chunk.location?.end), fixture.format);
    counts.set(fixture.format, (counts.get(fixture.format) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { pdf: 3, docx: 3, xlsx: 3, pptx: 3, md: 3, txt: 3 });
});

test('all six formats have deterministic empty or damaged failure samples', async () => {
  const failures = [
    { format: 'pdf', bytes: pdfFixture(null), expectedCode: 'RAG_NO_TEXT_CONTENT' },
    { format: 'docx', bytes: Buffer.from('PK damaged docx'), expectedCode: 'RAG_FILE_INVALID' },
    { format: 'xlsx', bytes: Buffer.from('PK damaged xlsx'), expectedCode: 'RAG_FILE_INVALID' },
    { format: 'pptx', bytes: Buffer.from('PK damaged pptx'), expectedCode: 'RAG_FILE_INVALID' },
    { format: 'md', bytes: Buffer.from('  \n\n', 'utf8'), expectedCode: 'RAG_NO_TEXT_CONTENT' },
    { format: 'txt', bytes: Buffer.from('  \n\n', 'utf8'), expectedCode: 'RAG_NO_TEXT_CONTENT' }
  ];
  for (const [index, fixture] of failures.entries()) {
    await assert.rejects(parseAndChunkDocument({
      documentId: `doc_matrix_failure_${index}`,
      fileName: `failure.${fixture.format}`,
      mime: MIME[fixture.format],
      bytes: fixture.bytes
    }), (error) => {
      assert.equal(error.errorCode, fixture.expectedCode, fixture.format);
      assert.equal(JSON.stringify(error.details).includes('stack'), false);
      return true;
    });
  }
});
