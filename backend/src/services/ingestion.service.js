import { parseDocument } from '../adapters/parsers/index.js';
import { chunkParsedBlocks, normalizeParsedBlocks } from '../domain/ingestion.js';

export async function parseAndChunkDocument(input, {
  parser = parseDocument,
  parseOptions = {},
  chunkOptions = {}
} = {}) {
  const parsed = await parser(input, parseOptions);
  const blocks = normalizeParsedBlocks(parsed);
  const chunks = chunkParsedBlocks({
    documentId: input.documentId,
    blocks,
    ...chunkOptions
  });
  return Object.freeze({ blocks, chunks });
}
