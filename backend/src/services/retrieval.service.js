import { AppError } from '../domain/errors.js';
import {
  citationResponse,
  embeddingFromBlob,
  rankCandidates
} from '../domain/retrieval.js';

class TopicVectorCache {
  constructor({ maxBytes = 128 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.values = new Map();
  }

  get(key, version) {
    const value = this.values.get(key);
    if (!value || value.version !== version) {
      if (value) {
        this.bytes -= value.bytes;
        this.values.delete(key);
      }
      return null;
    }
    this.values.delete(key);
    this.values.set(key, value);
    return value.entries;
  }

  set(key, version, entries) {
    const bytes = entries.reduce((total, entry) => total + entry.vector.byteLength, 0);
    const previous = this.values.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.values.delete(key);
    }
    while (this.values.size > 0 && this.bytes + bytes > this.maxBytes) {
      const oldestKey = this.values.keys().next().value;
      const oldest = this.values.get(oldestKey);
      this.bytes -= oldest.bytes;
      this.values.delete(oldestKey);
    }
    if (bytes <= this.maxBytes) {
      this.values.set(key, { version, entries, bytes });
      this.bytes += bytes;
    }
    return entries;
  }
}

export class RetrievalService {
  constructor({ repository, embeddingClient, config, cache = new TopicVectorCache() }) {
    this.repository = repository;
    this.embeddingClient = embeddingClient;
    this.config = config;
    this.cache = cache;
    this.activeRequests = 0;
  }

  async search({ topicId, question, limit }) {
    if (this.activeRequests >= this.config.maxConcurrentRequests) {
      throw new AppError({ statusCode: 429, errorCode: 'RAG_BUSY', message: '检索请求并发已达到上限' });
    }
    this.activeRequests += 1;
    try {
      const published = this.repository.publishedSet(topicId, this.config.model.embeddingModel);
      if (published.chunkCount === 0) {
        return { topicId, results: [] };
      }
      const embedded = await this.embeddingClient.embedQuery(question);
      const cacheKey = `${topicId}:${this.config.model.embeddingModel}`;
      let entries = this.cache.get(cacheKey, published.version);
      if (!entries) {
        entries = this.cache.set(cacheKey, published.version, this.repository.loadPublished(topicId, this.config.model.embeddingModel).map((row) => ({
          id: row.id,
          vector: embeddingFromBlob(row.embedding, row.embeddingDim)
        })));
      }
      if (entries.length === 0) {
        return { topicId, results: [] };
      }
      if (embedded.model !== this.config.model.embeddingModel || embedded.space !== 'cosine') {
        throw new AppError({ statusCode: 422, errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: '查询向量元数据与当前索引不一致' });
      }
      const queryVector = Float32Array.from(embedded.vector);
      const ranked = rankCandidates(queryVector, entries, {
        candidates: this.config.retrievalCandidates,
        threshold: this.config.evidenceThreshold
      }).slice(0, limit);
      const finalRows = this.repository.revalidate(topicId, this.config.model.embeddingModel, ranked.map((item) => item.id));
      const byId = new Map(finalRows.map((row) => [row.id, row]));
      const results = ranked
        .filter((item) => byId.has(item.id))
        .map((item) => citationResponse(byId.get(item.id), item.score));
      return { topicId, results };
    } finally {
      this.activeRequests -= 1;
    }
  }
}

export { TopicVectorCache };
