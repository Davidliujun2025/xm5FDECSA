import mammoth from 'mammoth';

import { normalizeParserError } from '../../domain/ingestion.js';
import { asBuffer, inspectOfficeArchive, paragraphBlocks } from './common.js';

export async function parseDocx(bytes, options = {}) {
  const buffer = asBuffer(bytes);
  inspectOfficeArchive(buffer, options);
  try {
    const result = await mammoth.extractRawText({ buffer });
    return paragraphBlocks(result.value, (index) => ({
      kind: 'paragraph',
      paragraph: index + 1
    }));
  } catch (error) {
    throw normalizeParserError(error, 'DOCX');
  }
}
