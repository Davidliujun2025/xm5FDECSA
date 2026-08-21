import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDocument } from '../../backend/src/adapters/parsers/index.js';
import { parseAndChunkDocument } from '../../backend/src/services/ingestion.service.js';
import {
  docxFixture,
  encryptedPdfFixture,
  expandedArchiveFixture,
  pdfFixture,
  pptxFixture,
  xlsxFixture
} from '../helpers/parser-fixtures.js';

const DOCUMENT_ID = 'doc_0123456789abcdef0123456789abcdef';

test('PDF, DOCX, XLSX, PPTX, Markdown and TXT preserve verifiable locations', async () => {
  const fixtures = [
    {
      fileName: 'sample.pdf', mime: 'application/pdf', bytes: pdfFixture(),
      expectedText: 'Visible PDF text', expectedLocation: { kind: 'page', page: 1 }
    },
    {
      fileName: 'sample.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docxFixture(),
      expectedText: 'DOCX first paragraph', expectedLocation: { kind: 'paragraph', paragraph: 1 }
    },
    {
      fileName: 'sample.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: await xlsxFixture(),
      expectedText: 'XLSX visible cell', expectedLocation: { kind: 'cell', sheet: 'Policies', cell: 'B2' }
    },
    {
      fileName: 'sample.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: pptxFixture(),
      expectedText: 'PPTX visible slide', expectedLocation: { kind: 'slide', slide: 1 }
    },
    {
      fileName: 'sample.md', mime: 'text/markdown', bytes: Buffer.from('# Policy\n\nMarkdown fact.', 'utf8'),
      expectedText: 'Policy', expectedLocation: { kind: 'markdown', headingPath: ['Policy'], lineStart: 1, lineEnd: 1 }
    },
    {
      fileName: 'sample.txt', mime: 'text/plain', bytes: Buffer.from('TXT visible line.\n\n', 'utf8'),
      expectedText: 'TXT visible line.', expectedLocation: { kind: 'line', lineStart: 1, lineEnd: 1 }
    }
  ];

  for (const fixture of fixtures) {
    const result = await parseAndChunkDocument({ documentId: DOCUMENT_ID, ...fixture });
    assert.equal(result.blocks[0].text, fixture.expectedText, fixture.fileName);
    assert.deepEqual(result.blocks[0].location, fixture.expectedLocation, fixture.fileName);
    assert.equal(result.chunks[0].documentId, DOCUMENT_ID);
    assert.deepEqual(result.chunks[0].location.start, fixture.expectedLocation);
  }
});

test('empty blocks and scanned PDFs fail with RAG_NO_TEXT_CONTENT', async () => {
  const cases = [
    { fileName: 'blank.txt', mime: 'text/plain', bytes: Buffer.from('\n \n', 'utf8') },
    { fileName: 'scan.pdf', mime: 'application/pdf', bytes: pdfFixture(null) }
  ];
  for (const input of cases) {
    await assert.rejects(
      parseAndChunkDocument({ documentId: DOCUMENT_ID, ...input }),
      (error) => error.errorCode === 'RAG_NO_TEXT_CONTENT'
    );
  }
});

test('damaged, encrypted, over-expanded and mismatched inputs use stable safe errors', async () => {
  const cases = [
    {
      input: { fileName: 'bad.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-broken') },
      code: 'RAG_FILE_INVALID'
    },
    {
      input: { fileName: 'encrypted.pdf', mime: 'application/pdf', bytes: encryptedPdfFixture() },
      code: 'RAG_FILE_INVALID'
    },
    {
      input: { fileName: 'bad.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: Buffer.from('not zip') },
      code: 'RAG_FILE_INVALID'
    },
    {
      input: { fileName: 'wrong.txt', mime: 'application/pdf', bytes: Buffer.from('text') },
      code: 'RAG_FILE_INVALID'
    },
    {
      input: { fileName: 'unsupported.exe', mime: 'application/octet-stream', bytes: Buffer.from('text') },
      code: 'RAG_UNSUPPORTED_FORMAT'
    },
    {
      input: {
        fileName: 'parser-error.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: expandedArchiveFixture(16)
      },
      code: 'RAG_PARSE_FAILED'
    }
  ];
  for (const { input, code } of cases) {
    await assert.rejects(parseDocument(input), (error) => {
      assert.equal(error.errorCode, code);
      assert.equal(error.stack.includes(input.fileName), false);
      return true;
    });
  }

  await assert.rejects(
    parseDocument({
      fileName: 'large.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: expandedArchiveFixture()
    }, { maxExpandedBytes: 64, maxEntryBytes: 64 }),
    (error) => error.errorCode === 'RAG_CAPACITY_LIMIT' && !('stack' in error.details)
  );
});
