import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  createParsedBlock,
  invalidParseFileError,
  normalizeParserError
} from '../../domain/ingestion.js';
import { asBuffer } from './common.js';

function pageText(items) {
  return items.map((item) => {
    if (typeof item?.str !== 'string') {
      return '';
    }
    return `${item.str}${item.hasEOL ? '\n' : ' '}`;
  }).join('').trim();
}

export async function parsePdf(bytes) {
  const buffer = asBuffer(bytes);
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw invalidParseFileError('PDF 文件头损坏');
  }
  const trailer = buffer.subarray(Math.max(0, buffer.length - 65_536)).toString('latin1');
  if (/\/Encrypt\s+(?:\d+\s+\d+\s+R|<<)/.test(trailer)) {
    throw invalidParseFileError('PDF 已加密，无法解析');
  }

  let loadingTask;
  let pdf;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0
    });
    pdf = await loadingTask.promise;
    const blocks = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      blocks.push(createParsedBlock({
        text: pageText(content.items),
        location: { kind: 'page', page: pageNumber },
        order: pageNumber - 1
      }));
      page.cleanup();
    }
    return blocks;
  } catch (error) {
    if (error?.name === 'PasswordException') {
      throw invalidParseFileError('PDF 已加密，无法解析');
    }
    if (error?.name === 'InvalidPDFException' || error?.name === 'MissingPDFException') {
      throw invalidParseFileError('PDF 文件损坏或结构不正确');
    }
    throw normalizeParserError(error, 'PDF');
  } finally {
    await pdf?.destroy();
    await loadingTask?.destroy();
  }
}
