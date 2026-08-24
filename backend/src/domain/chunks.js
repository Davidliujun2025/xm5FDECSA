import { createHash, randomUUID } from 'node:crypto';

import { AppError } from './errors.js';

export const MAX_EMBEDDING_BATCH = 32;
export const EMBEDDING_SPACE = 'cosine';

export class ModelError extends AppError {
  constructor({
    statusCode = 503,
    errorCode = 'RAG_MODEL_UNAVAILABLE',
    message = 'Embedding 模型暂时不可用',
    details = {},
    retryable = false,
    cause
  } = {}) {
    super({ statusCode, errorCode, message, details, cause });
    this.name = 'ModelError';
    this.retryable = retryable;
  }
}

function validateVector(vector, expectedDimension) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应向量格式非法' });
  }
  if (vector.length === 0 || (expectedDimension && vector.length !== expectedDimension)) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应向量维度不一致' });
  }
  const output = Float32Array.from(vector);
  if ([...output].some((value) => !Number.isFinite(value))) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应包含非法数值' });
  }
  return output;
}

export function embeddingToBlob(vector) {
  const normalized = validateVector(vector);
  const bytes = Buffer.allocUnsafe(normalized.length * 4);
  normalized.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

export function createParseVersion({ model, dimension, space = EMBEDDING_SPACE, chunkTargetChars, chunkOverlapChars }) {
  const identity = JSON.stringify({
    parser: 'v1',
    chunker: 'v1',
    model,
    dimension,
    space,
    chunkTargetChars,
    chunkOverlapChars
  });
  return `index_${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

export function createIndexedChunks({
  topicId,
  drafts,
  vectors,
  model,
  dimension,
  space = EMBEDDING_SPACE,
  parseVersion,
  now = () => new Date(),
  idGenerator = () => `chunk_${randomUUID().replaceAll('-', '')}`
}) {
  if (!Array.isArray(drafts) || drafts.length === 0 || !Array.isArray(vectors) || drafts.length !== vectors.length) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应数量与 chunk 不一致' });
  }
  if (!model || !parseVersion || space !== EMBEDDING_SPACE || !Number.isSafeInteger(dimension) || dimension <= 0) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 元数据非法' });
  }
  const createdAt = now().toISOString();
  return Object.freeze(drafts.map((draft, index) => {
    const vector = validateVector(vectors[index], dimension);
    return Object.freeze({
      id: idGenerator(),
      topicId,
      documentId: draft.documentId,
      ordinal: draft.ordinal,
      text: draft.text,
      location: JSON.stringify(draft.location),
      textHash: createHash('sha256').update(draft.text).digest('hex'),
      embedding: embeddingToBlob(vector),
      embeddingDim: dimension,
      embeddingModel: model,
      embeddingSpace: space,
      parseVersion,
      createdAt
    });
  }));
}
