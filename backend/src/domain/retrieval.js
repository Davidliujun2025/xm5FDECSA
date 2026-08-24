import { AppError } from './errors.js';

export function embeddingFromBlob(blob, dimension) {
  const bytes = Buffer.from(blob);
  if (!Number.isSafeInteger(dimension) || dimension <= 0 || bytes.length !== dimension * 4) {
    throw new AppError({ statusCode: 422, errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: '索引向量维度非法' });
  }
  const vector = new Float32Array(dimension);
  for (let index = 0; index < dimension; index += 1) {
    vector[index] = bytes.readFloatLE(index * 4);
    if (!Number.isFinite(vector[index])) {
      throw new AppError({ statusCode: 422, errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: '索引向量包含非法数值' });
    }
  }
  return vector;
}

export function cosineSimilarity(left, right) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length === 0 || left.length !== right.length) {
    throw new AppError({ statusCode: 422, errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: '查询向量与索引维度不一致' });
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    throw new AppError({ statusCode: 422, errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: '查询或索引向量不可用于余弦检索' });
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function rankCandidates(queryVector, entries, { candidates, threshold }) {
  return entries
    .map((entry) => ({ id: entry.id, score: cosineSimilarity(queryVector, entry.vector) }))
    .sort((left, right) => (right.score - left.score) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .slice(0, candidates)
    .filter((item) => item.score >= threshold);
}

export function citationResponse(row, score) {
  return Object.freeze({
    citationId: row.id,
    documentId: row.documentId,
    fileName: row.fileName,
    location: structuredClone(row.location),
    excerpt: row.text,
    score: Number(Math.max(-1, Math.min(1, score)).toFixed(6))
  });
}
