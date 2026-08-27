import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { AppError } from '../domain/errors.js';
import { parseFaqMarkdown } from '../domain/faqs.js';

export function loadFaqEntries(sourceDir) {
  try {
    const files = readdirSync(sourceDir)
      .filter((fileName) => /^(?:pmp|acp|pba|fde)\.md$/i.test(fileName))
      .sort((left, right) => left.localeCompare(right));
    if (files.length !== 4) {
      throw new Error('FAQ 素材文件必须包含 PMP、ACP、PBA、FDE 四份');
    }
    const entries = [];
    for (const fileName of files) {
      const content = readFileSync(path.join(sourceDir, fileName), 'utf8');
      const domain = path.basename(fileName, '.md').toUpperCase();
      const sourceHash = createHash('sha256').update(content).digest('hex');
      entries.push(...parseFaqMarkdown({ content, domain, sourceFile: fileName }).map((entry) => ({
        ...entry,
        sourceHash
      })));
    }
    if (entries.length === 0) throw new Error('FAQ 素材未解析出问答');
    return entries;
  } catch (error) {
    throw new AppError({
      statusCode: 500,
      errorCode: 'RAG_FAQ_SOURCE_INVALID',
      message: 'FAQ 知识库素材加载失败',
      cause: error
    });
  }
}
