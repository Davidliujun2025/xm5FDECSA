import { unzipSync } from 'fflate';

import {
  createParsedBlock,
  invalidParseFileError,
  parseLimitError
} from '../../domain/ingestion.js';

export const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 2048,
  maxExpandedBytes: 120 * 1024 * 1024,
  maxEntryBytes: 40 * 1024 * 1024
});

export function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }
  if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
    return Buffer.from(bytes);
  }
  throw invalidParseFileError();
}

export function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(asBuffer(bytes)).replace(/^\uFEFF/, '');
  } catch {
    throw invalidParseFileError('文本文件必须使用 UTF-8 编码');
  }
}

function validateEntryName(name) {
  const normalized = name.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..') || /^[a-z]:/i.test(normalized)) {
    throw invalidParseFileError('Office 文件包含非法条目路径');
  }
  return normalized;
}

export function inspectOfficeArchive(bytes, {
  select = () => false,
  maxEntries = DEFAULT_ARCHIVE_LIMITS.maxEntries,
  maxExpandedBytes = DEFAULT_ARCHIVE_LIMITS.maxExpandedBytes,
  maxEntryBytes = DEFAULT_ARCHIVE_LIMITS.maxEntryBytes
} = {}) {
  let entryCount = 0;
  let expandedBytes = 0;
  try {
    return unzipSync(asBuffer(bytes), {
      filter(entry) {
        const name = validateEntryName(entry.name);
        entryCount += 1;
        expandedBytes += entry.originalSize;
        if (entryCount > maxEntries || expandedBytes > maxExpandedBytes || entry.originalSize > maxEntryBytes) {
          throw parseLimitError({ maxEntries, maxExpandedBytes, maxEntryBytes });
        }
        return select(name);
      }
    });
  } catch (error) {
    if (error?.errorCode) {
      throw error;
    }
    throw invalidParseFileError('Office 文件损坏或无法展开');
  }
}

export function paragraphBlocks(text, locationFactory) {
  const paragraphs = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  return paragraphs.map((paragraph, index) => createParsedBlock({
    text: paragraph,
    location: locationFactory(index),
    order: index
  }));
}
