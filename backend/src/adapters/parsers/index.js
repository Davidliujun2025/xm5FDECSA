import path from 'node:path';

import { SUPPORTED_FORMATS } from '../../domain/documents.js';
import {
  invalidParseFileError,
  normalizeParserError,
  ParsingError
} from '../../domain/ingestion.js';
import { asBuffer } from './common.js';
import { parseDocx } from './docx.js';
import { parsePdf } from './pdf.js';
import { parsePptx } from './pptx.js';
import { parseMarkdown, parseTxt } from './text.js';
import { parseXlsx } from './xlsx.js';

const PARSERS = Object.freeze({
  '.pdf': parsePdf,
  '.docx': parseDocx,
  '.xlsx': parseXlsx,
  '.pptx': parsePptx,
  '.md': parseMarkdown,
  '.txt': parseTxt
});

function validateInput({ fileName, mime, bytes }) {
  if (typeof fileName !== 'string' || !fileName || fileName.includes('/') || fileName.includes('\\')) {
    throw invalidParseFileError('解析文件名格式非法');
  }
  const extension = path.extname(fileName).toLowerCase();
  const format = SUPPORTED_FORMATS[extension];
  if (!format || !PARSERS[extension]) {
    throw new ParsingError({
      errorCode: 'RAG_UNSUPPORTED_FORMAT',
      message: '文件格式不受支持'
    });
  }
  if (!format.mime.includes(String(mime || '').toLowerCase())) {
    throw invalidParseFileError('文件扩展名与 MIME 不匹配');
  }
  const buffer = asBuffer(bytes);
  if (buffer.length === 0) {
    throw invalidParseFileError('文件为空');
  }
  return { extension, buffer };
}

export async function parseDocument(input, options = {}) {
  const { extension, buffer } = validateInput(input);
  try {
    return await PARSERS[extension](buffer, options);
  } catch (error) {
    throw normalizeParserError(error, extension.slice(1));
  }
}
