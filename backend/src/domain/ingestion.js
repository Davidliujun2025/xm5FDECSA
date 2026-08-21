import { AppError } from './errors.js';

export const PARSE_ERROR_CODE = Object.freeze({
  INVALID_FILE: 'RAG_FILE_INVALID',
  NO_TEXT: 'RAG_NO_TEXT_CONTENT',
  LIMIT_EXCEEDED: 'RAG_CAPACITY_LIMIT',
  FAILED: 'RAG_PARSE_FAILED'
});

export class ParsingError extends AppError {
  constructor({
    statusCode = 422,
    errorCode = PARSE_ERROR_CODE.FAILED,
    message = '文档解析失败',
    details = {},
    cause
  } = {}) {
    super({ statusCode, errorCode, message, details, cause });
    this.name = 'ParsingError';
  }
}

export function noTextContentError() {
  return new ParsingError({
    errorCode: PARSE_ERROR_CODE.NO_TEXT,
    message: '文档没有可用的文本内容'
  });
}

export function invalidParseFileError(message = '文档文件损坏或格式不正确') {
  return new ParsingError({
    errorCode: PARSE_ERROR_CODE.INVALID_FILE,
    message
  });
}

export function parseLimitError(details = {}) {
  return new ParsingError({
    statusCode: 413,
    errorCode: PARSE_ERROR_CODE.LIMIT_EXCEEDED,
    message: '文档展开后超过解析容量限制',
    details
  });
}

export function normalizeParserError(error, format) {
  if (error instanceof ParsingError) {
    return error;
  }
  return new ParsingError({
    errorCode: PARSE_ERROR_CODE.FAILED,
    message: `${String(format || '文档').toUpperCase()} 解析失败`,
    cause: error
  });
}

export function normalizeBlockText(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cloneLocation(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    throw new TypeError('ParsedBlock location must be an object');
  }
  return structuredClone(location);
}

export function createParsedBlock({ text, location, order }) {
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new TypeError('ParsedBlock order must be a non-negative integer');
  }
  return Object.freeze({
    text: normalizeBlockText(text),
    location: Object.freeze(cloneLocation(location)),
    order
  });
}

export function normalizeParsedBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    throw new TypeError('blocks must be an array');
  }
  const normalized = blocks
    .map((block, index) => ({ ...block, sourceIndex: index, text: normalizeBlockText(block?.text) }))
    .filter((block) => block.text.length > 0)
    .sort((left, right) => (left.order - right.order) || (left.sourceIndex - right.sourceIndex))
    .map((block, order) => createParsedBlock({
      text: block.text,
      location: block.location,
      order
    }));

  if (normalized.length === 0) {
    throw noTextContentError();
  }
  return Object.freeze(normalized);
}

function flattenBlocks(blocks) {
  let text = '';
  const spans = [];
  for (const block of blocks) {
    if (text) {
      text += '\n\n';
    }
    const start = text.length;
    text += block.text;
    spans.push({ start, end: text.length, location: block.location, order: block.order });
  }
  return { text, spans };
}

function lastBoundary(text, lower, preferred, upper) {
  const separators = ['\n\n', '。', '！', '？', '. ', '! ', '? ', '; ', '；', '\n', ' '];
  for (const ceiling of [preferred, upper]) {
    let best = -1;
    const window = text.slice(lower, ceiling);
    for (const separator of separators) {
      const position = window.lastIndexOf(separator);
      if (position >= 0 && lower + position + separator.length > best) {
        best = lower + position + separator.length;
      }
    }
    if (best >= lower) {
      return best;
    }
  }
  return preferred;
}

function chunkLocation(spans, start, end) {
  const sources = spans
    .filter((span) => span.end > start && span.start < end)
    .map((span) => ({ order: span.order, location: structuredClone(span.location) }));
  return Object.freeze({
    start: sources[0]?.location ?? null,
    end: sources.at(-1)?.location ?? null,
    sources: Object.freeze(sources)
  });
}

export function createChunkDraft({ documentId, ordinal, text, location }) {
  if (typeof documentId !== 'string' || documentId.length === 0) {
    throw new TypeError('Chunk documentId is required');
  }
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new TypeError('Chunk ordinal must be a non-negative integer');
  }
  const normalizedText = normalizeBlockText(text);
  if (!normalizedText) {
    throw noTextContentError();
  }
  return Object.freeze({
    documentId,
    ordinal,
    text: normalizedText,
    location
  });
}

export function chunkParsedBlocks({
  documentId,
  blocks,
  minChars = 800,
  targetChars = 1000,
  maxChars = 1200,
  overlapChars = 150
}) {
  if (!(minChars > 0 && minChars <= targetChars && targetChars <= maxChars)) {
    throw new TypeError('chunk size settings are invalid');
  }
  if (!(overlapChars >= 0 && overlapChars < minChars)) {
    throw new TypeError('chunk overlap setting is invalid');
  }

  const normalized = normalizeParsedBlocks(blocks);
  const { text, spans } = flattenBlocks(normalized);
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const remaining = text.length - start;
    const end = remaining <= maxChars
      ? text.length
      : lastBoundary(
        text,
        start + minChars,
        Math.min(start + targetChars, text.length),
        Math.min(start + maxChars, text.length)
      );
    const chunkText = text.slice(start, end).trim();
    if (chunkText) {
      chunks.push(createChunkDraft({
        documentId,
        ordinal: chunks.length,
        text: chunkText,
        location: chunkLocation(spans, start, end)
      }));
    }
    if (end >= text.length) {
      break;
    }
    const nextStart = Math.max(start + 1, end - overlapChars);
    start = nextStart;
  }

  if (chunks.length === 0) {
    throw noTextContentError();
  }
  return Object.freeze(chunks);
}
