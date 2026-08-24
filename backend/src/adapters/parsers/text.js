import { createParsedBlock } from '../../domain/ingestion.js';
import { decodeUtf8 } from './common.js';

export async function parseTxt(bytes) {
  const lines = decodeUtf8(bytes).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let start = null;
  let content = [];

  function flush(endIndex) {
    if (start === null) {
      return;
    }
    blocks.push(createParsedBlock({
      text: content.join('\n'),
      location: { kind: 'line', lineStart: start + 1, lineEnd: endIndex },
      order: blocks.length
    }));
    start = null;
    content = [];
  }

  lines.forEach((line, index) => {
    if (!line.trim()) {
      flush(index);
      return;
    }
    if (start === null) {
      start = index;
    }
    content.push(line);
  });
  flush(lines.length);
  return blocks;
}

export async function parseMarkdown(bytes) {
  const lines = decodeUtf8(bytes).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const headingPath = [];
  let paragraphStart = null;
  let paragraph = [];

  function flush(endIndex) {
    if (paragraphStart === null) {
      return;
    }
    blocks.push(createParsedBlock({
      text: paragraph.join('\n'),
      location: {
        kind: 'markdown',
        headingPath: [...headingPath],
        lineStart: paragraphStart + 1,
        lineEnd: endIndex
      },
      order: blocks.length
    }));
    paragraphStart = null;
    paragraph = [];
  }

  lines.forEach((line, index) => {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush(index);
      const level = heading[1].length;
      headingPath.length = level - 1;
      headingPath[level - 1] = heading[2];
      blocks.push(createParsedBlock({
        text: heading[2],
        location: {
          kind: 'markdown',
          headingPath: [...headingPath],
          lineStart: index + 1,
          lineEnd: index + 1
        },
        order: blocks.length
      }));
      return;
    }
    if (!line.trim()) {
      flush(index);
      return;
    }
    if (paragraphStart === null) {
      paragraphStart = index;
    }
    paragraph.push(line);
  });
  flush(lines.length);
  return blocks;
}
